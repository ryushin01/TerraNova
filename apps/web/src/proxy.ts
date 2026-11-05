import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);
const PUBLIC_PATHS = ["/login", "/setup"];

/**
 * Only a first check for a friendlier redirect: a cookie's presence proves nothing. The real
 * protection is the server, which verifies the session before sending any farm data.
 */
export default function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(segments[0] ?? "");
  const locale = hasLocale ? segments[0] : routing.defaultLocale;
  const path = `/${(hasLocale ? segments.slice(1) : segments).join("/")}`;

  if (!PUBLIC_PATHS.includes(path) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
