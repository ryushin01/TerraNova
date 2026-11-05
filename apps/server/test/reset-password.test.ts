import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "../src/auth";
import { openDatabase } from "../src/db";
import { ControlHistory } from "../src/history";

const OLD_PASSWORD = "correct-horse-1";
const EMAIL = "admin@terranova.test";
const FREE_PORT = "14977";
const root = mkdtempSync(join(tmpdir(), "terranova-reset-"));
const dataDir = join(root, "db");
const script = join(import.meta.dir, "../src/reset-password.ts");

const withAuth = async <T,>(use: (auth: ReturnType<typeof createAuth>) => Promise<T>): Promise<T> => {
  const database = await openDatabase(dataDir);
  try {
    return await use(
      createAuth({ db: database.db, baseURL: "http://localhost:3000", secret: "s".repeat(40), trustedOrigins: [] }),
    );
  } finally {
    await database.close();
  }
};

async function run(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["bun", script, ...args], {
    env: { ...process.env, DATA_DIR: dataDir, RESET_CHECK_PORT: FREE_PORT, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

const canSignIn = (password: string) =>
  withAuth(async (auth) => {
    try {
      await auth.api.signInEmail({ body: { email: EMAIL, password } });
      return true;
    } catch {
      return false;
    }
  });

beforeAll(async () => {
  await withAuth((auth) =>
    auth.api.createUser({ body: { name: "Admin", email: EMAIL, password: OLD_PASSWORD, role: "admin" } }),
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("without an email it lists admin accounts and changes nothing", async () => {
  const { stdout, code } = await run([]);
  expect(code).toBe(0);
  expect(stdout).toContain(EMAIL);
  expect(await canSignIn(OLD_PASSWORD)).toBe(true);
});

test("an unknown email fails", async () => {
  const { stderr, code } = await run(["nobody@terranova.test"]);
  expect(code).toBe(1);
  expect(stderr).toContain("nobody@terranova.test");
});

test("refuses to run while the server is up, leaving the password alone", async () => {
  const server: Server = createServer().listen(14978, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { stderr, code } = await run([EMAIL], { RESET_CHECK_PORT: "14978" });
  server.close();
  expect(code).toBe(1);
  expect(stderr).toContain("Stop it first");
  expect(await canSignIn(OLD_PASSWORD)).toBe(true);
});

test("refuses a missing database instead of creating an empty one", async () => {
  const missing = join(root, "missing");
  const { stderr, code } = await run([EMAIL], { DATA_DIR: missing });
  expect(code).toBe(1);
  expect(stderr).toContain("No database");
  expect(await Bun.file(join(missing, "PG_VERSION")).exists()).toBe(false);
});

test("sets a temporary password, and the old one and old sessions stop working", async () => {
  const session = await withAuth((auth) => auth.api.signInEmail({ body: { email: EMAIL, password: OLD_PASSWORD } }));

  const { stdout, code } = await run([EMAIL.toUpperCase()]);
  expect(code).toBe(0);
  const password = /^ {2}(\S+)$/m.exec(stdout)?.[1];
  expect(password?.length).toBeGreaterThanOrEqual(16);

  expect(await canSignIn(OLD_PASSWORD)).toBe(false);
  expect(await canSignIn(password!)).toBe(true);

  const still = await withAuth((auth) =>
    auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${session.token}` }) }),
  );
  expect(still).toBeNull();

  const database = await openDatabase(dataDir);
  const { entries } = await new ControlHistory(database.db).list({ limit: 5, action: "password_reset" });
  await database.close();
  expect(entries[0]).toMatchObject({ actorName: "복구 명령", detail: { target: "Admin" }, result: "ok" });
  expect(JSON.stringify(entries)).not.toContain(password!);
});
