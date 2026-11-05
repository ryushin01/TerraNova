import { ac, roles } from "@terranova/shared/roles";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import type { Database } from "./db";
import { account, session, user, verification } from "./db/schema";
import { ControlHistory, type Actor } from "./history";

export const MIN_PASSWORD_LENGTH = 8;

/** The admin plugin's account routes don't apply the sign-up password rules, so check here. */
const ADMIN_PASSWORD_ROUTES = ["/admin/create-user", "/admin/set-user-password"];

interface AuthOptions {
  db: Database;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

export function createAuth({ db, baseURL, secret, trustedOrigins }: AuthOptions) {
  const history = new ControlHistory(db);
  const findUser = async (id: unknown) => {
    if (typeof id !== "string") return undefined;
    const [found] = await db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.id, id));
    return found;
  };

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    // Applies when NODE_ENV is production, which is how the network mode runs.
    rateLimit: {
      window: 60,
      max: 600,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    // These accounts can operate pumps, so only an admin can create one.
    emailAndPassword: { enabled: true, disableSignUp: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ADMIN_PASSWORD_ROUTES.includes(ctx.path)) return;
        const password = ctx.body?.password ?? ctx.body?.newPassword;
        if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
          throw new APIError("BAD_REQUEST", { message: "Password is too short" });
        }
      }),
      // Records who changed whose password, never the password itself.
      after: createAuthMiddleware(async (ctx) => {
        const isReset = ctx.path === "/admin/set-user-password";
        if (!isReset && ctx.path !== "/change-password") return;
        try {
          const returned = ctx.context.returned as { user?: { id?: string } } | Error | undefined;
          const failed = returned instanceof Error;
          const changedOwn = !failed && !isReset ? returned?.user?.id : undefined;
          // Changing your own password replaces your session, so the returned user identifies you.
          const actorId = changedOwn ?? (await getSessionFromCtx(ctx))?.user.id;
          const actor: Actor | undefined = await findUser(actorId);
          if (!actor) return;
          const status = failed ? (returned as APIError).status : "OK";
          const result = !failed ? "ok" : status === "FORBIDDEN" ? "forbidden" : "failed";
          const target = isReset ? await findUser(ctx.body?.userId) : undefined;
          await history.record(actor, [
            {
              action: isReset ? "password_reset" : "password_change",
              detail: target ? { target: target.name } : {},
              result,
            },
          ]);
        } catch (error) {
          console.error("[history] could not record a password change:", error);
        }
      }),
    },
    plugins: [admin({ ac, roles, defaultRole: "viewer", adminRoles: ["admin"] })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
