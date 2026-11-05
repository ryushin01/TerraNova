import type { HistoryAction } from "@terranova/shared";
import { ac, roles } from "@terranova/shared/roles";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import { account, session, user, verification } from "./db/schema";
import { type Actor, ControlHistory } from "./history";

export const MIN_PASSWORD_LENGTH = 8;

/** The admin plugin's account routes don't apply the sign-up password rules, so check here. */
const ADMIN_PASSWORD_ROUTES = ["/admin/create-user", "/admin/set-user-password"];

const RECORDED_ROUTES: Record<string, HistoryAction> = {
  "/change-password": "password_change",
  "/admin/set-user-password": "password_reset",
  "/admin/create-user": "account_create",
  "/admin/remove-user": "account_remove",
  "/admin/set-role": "role_change",
};

interface AuthOptions {
  db: Database;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

export function createAuth({ db, baseURL, secret, trustedOrigins }: AuthOptions) {
  const history = new ControlHistory(db);
  const removedNames = new Map<string, string>();
  const findUser = async (id: unknown) => {
    if (typeof id !== "string") return undefined;
    const [found] = await db
      .select({ id: user.id, name: user.name, role: user.role })
      .from(user)
      .where(eq(user.id, id));
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
        if (ctx.path === "/admin/remove-user" && typeof ctx.body?.userId === "string") {
          const removing = await findUser(ctx.body.userId);
          if (removing) removedNames.set(removing.id, removing.name);
        }
        if (!ADMIN_PASSWORD_ROUTES.includes(ctx.path)) return;
        const password = ctx.body?.password ?? ctx.body?.newPassword;
        if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
          throw new APIError("BAD_REQUEST", { message: "Password is too short" });
        }
      }),
      // Records who changed whose password or account, never the password itself.
      after: createAuthMiddleware(async (ctx) => {
        const action = RECORDED_ROUTES[ctx.path];
        if (!action) return;
        try {
          const returned = ctx.context.returned as { user?: { id?: string; name?: string } } | Error | undefined;
          const failed = returned instanceof Error;
          // Changing your own password replaces your session, so the returned user identifies you.
          const changedOwn = !failed && action === "password_change" ? returned?.user?.id : undefined;
          const actorId = changedOwn ?? (await getSessionFromCtx(ctx))?.user.id;
          const actor: Actor | undefined = await findUser(actorId);
          if (!actor) return;

          const status = failed ? (returned as APIError).status : "OK";
          const result = !failed ? "ok" : status === "FORBIDDEN" ? "forbidden" : "failed";
          const userId = ctx.body?.userId;
          // A removed account is gone by now, so its name was noted beforehand.
          const noted = typeof userId === "string" ? removedNames.get(userId) : undefined;
          if (typeof userId === "string") removedNames.delete(userId);
          const target =
            noted ??
            (await findUser(userId))?.name ??
            (action === "account_create" ? String(ctx.body?.name ?? "") : "");

          await history.record(actor, [
            {
              action,
              detail: {
                ...(target ? { target } : {}),
                ...(action === "role_change" || action === "account_create"
                  ? { role: String(ctx.body?.role ?? "") }
                  : {}),
              },
              result,
            },
          ]);
        } catch (error) {
          console.error("[history] could not record an account change:", error);
        }
      }),
    },
    plugins: [admin({ ac, roles, defaultRole: "viewer", adminRoles: ["admin"] })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
