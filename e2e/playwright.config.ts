import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every spec starts its own backend and simulator on the app's fixed ports (see stack.ts), so
 * tests run one at a time and those ports must be free. Stop `bun run dev` first.
 */
export default defineConfig({
  testDir: here,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "e2e", testMatch: "**/*.e2e.ts" },
    { name: "memory", testMatch: "**/*.memory.ts", timeout: 15 * 60_000 },
  ],
  webServer: {
    // Memory is measured on a production build: development tooling holds on to memory itself.
    command: process.env.TERRANOVA_PRODUCTION ? "bun run build && bun run start" : "bun run dev",
    cwd: join(here, "../apps/web"),
    url: "http://127.0.0.1:3000/ko/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
