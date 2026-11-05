import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const DEFAULT_SOCKET_PORT = 4000;

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@terranova/shared"],
  // Browsers must always see the current service worker, and it should load nothing else.
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ],
  // Same-origin login, so browsers treat the session cookie as first-party.
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `http://127.0.0.1:${DEFAULT_SOCKET_PORT}/api/:path*`,
    },
  ],
};

export default withNextIntl(nextConfig);
