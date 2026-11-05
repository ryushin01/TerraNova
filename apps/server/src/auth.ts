import { ac, roles } from "@terranova/shared/roles";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import type { Database } from "./db";
import { account, session, user, verification } from "./db/schema";

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
  return betterAuth({
    baseURL,
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
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
    },
    plugins: [admin({ ac, roles, defaultRole: "viewer", adminRoles: ["admin"] })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
