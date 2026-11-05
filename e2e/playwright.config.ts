import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { PORT_ENV, WEB_ORIGIN, WEB_PORT } from "./ports";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every spec starts its own backend and simulator (see stack.ts), so tests run one at a time.
 * They use their own ports (see ports.ts), so `bun run dev` can stay running.
 */
export default defineConfig({
  testDir: here,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "e2e", testMatch: "**/*.e2e.ts" },
    { name: "memory", testMatch: "**/*.memory.ts", timeout: 15 * 60_000 },
    { name: "screenshots", testMatch: "**/*.screenshots.ts" },
  ],
  webServer: {
    // A production build for memory, since development tooling holds on to memory itself, and for
    // screenshots, so they don't show the development indicator.
    command: process.env.TERRANOVA_PRODUCTION ? "bun run build && bun run start" : "bun run dev",
    cwd: join(here, "../apps/web"),
    url: `http://127.0.0.1:${WEB_PORT}/ko/login`,
    env: PORT_ENV,
    reuseExistingServer: false,
    stdout: process.env.E2E_LOG_DIR ? "pipe" : "ignore",
    stderr: process.env.E2E_LOG_DIR ? "pipe" : "ignore",
    timeout: 120_000,
  },
});
