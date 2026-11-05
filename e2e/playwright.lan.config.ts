import { mkdtempSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const address = Object.values(networkInterfaces())
  .flat()
  .find((item) => item && item.family === "IPv4" && !item.internal)?.address;

// Config files load again in each worker, so create the throwaway data folder only once.
process.env.TERRANOVA_LAN_DATA ??= join(mkdtempSync(join(tmpdir(), "terranova-lan-")), "db");

/** Network mode exactly as `bun run lan` runs it, reached through this computer's real address. */
export default defineConfig({
  testDir: here,
  testMatch: "**/*.lan.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `https://${address}:8443`,
    channel: "chrome",
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run lan",
    cwd: join(here, ".."),
    url: "https://localhost:8443/ko/login",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 4000 },
    env: {
      DATA_DIR: process.env.TERRANOVA_LAN_DATA,
      SIM_INITIAL_SOIL: "30",
      WATERING_DURATION_SEC: "4",
      WATERING_TIMES: "",
    },
  },
});
