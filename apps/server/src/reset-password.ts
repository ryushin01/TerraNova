/**
 * Recovers an account when nobody can sign in to reset it, such as a lone admin who forgot their
 * password. Needs access to this computer, which is what authorizes it.
 *
 *   bun run admin:reset-password            lists admin accounts
 *   bun run admin:reset-password <email>    sets a temporary password and signs them out
 *
 * The password is generated rather than passed in, so it never lands in shell history.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { DEFAULT_SOCKET_PORT } from "@terranova/shared";
import { eq } from "drizzle-orm";
import { createAuth } from "./auth";
import { openDatabase } from "./db";
import { user } from "./db/schema";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "../.data/pglite");
const email = process.argv[2]?.trim().toLowerCase();

// PGlite allows one process at a time, and a second one could damage the database.
if (await isListening(Number(process.env.RESET_CHECK_PORT ?? DEFAULT_SOCKET_PORT))) {
  fail("The server is running. Stop it first (Ctrl+C), then run this again.");
}
// Opening a missing database would quietly create an empty one.
if (!existsSync(dataDir)) fail(`No database found at ${dataDir}.`);

const database = await openDatabase(dataDir);
// Nothing is signed here, so this process doesn't need the server's real key.
const auth = createAuth({
  db: database.db,
  baseURL: "http://localhost:3000",
  secret: randomBytes(32).toString("hex"),
  trustedOrigins: [],
});

let exitCode = 0;
if (!email) {
  const admins = await database.db.select({ email: user.email }).from(user).where(eq(user.role, "admin"));
  console.log("Usage: bun run admin:reset-password <email>\n");
  console.log(admins.length > 0 ? `Admin accounts:\n${admins.map((a) => `  ${a.email}`).join("\n")}` : "No admin accounts yet.");
} else {
  const [account] = await database.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!account) {
    console.error(`No account with the email ${email}.`);
    exitCode = 1;
  } else {
    const password = randomBytes(12).toString("base64url");
    const context = await auth.$context;
    const hash = await context.password.hash(password);
    // The password changes last, right before it's shown: a failure anywhere earlier must not
    // replace it with one nobody ever saw, which would lock the account.
    await context.internalAdapter.deleteUserSessions(account.id);
    await context.internalAdapter.updatePassword(account.id, hash);
    console.log(`Temporary password for ${email}:\n\n  ${password}\n`);
    console.log("Sign in with it, then change it from the account menu. Existing sign-ins have ended.");
  }
}

await database.close();
process.exit(exitCode);
