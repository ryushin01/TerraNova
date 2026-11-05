import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
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
  // Without a language in the path, next-intl picks one from the saved choice or the browser's
  // language. Its redirect comes back here with the language, for the sign-in check below.
  if (!hasLocale) return intl(request);
  const locale = segments[0];
  const path = `/${segments.slice(1).join("/")}`;

  if (!PUBLIC_PATHS.includes(path) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
