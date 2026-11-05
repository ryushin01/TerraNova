import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MQTT_PORT, DEFAULT_SOCKET_PORT, SOIL_SUFFICIENT_PCT, normalizeAlarmTimes } from "@terranova/shared";
import { startApp } from "./app";
import { createAuth } from "./auth";
import { startBroker } from "./broker";
import { openDatabase } from "./db";

const MINUTE = 60_000;
const env = process.env;
const webPort = env.WEB_PORT ?? "3000";

const dataDir = env.DATA_DIR ?? join(import.meta.dir, "../.data/pglite");
// PUBLIC_ORIGIN is set in network mode: it makes session cookies HTTPS-only.
const publicOrigin = env.PUBLIC_ORIGIN;
const webOrigins = [
  ...(publicOrigin ? [publicOrigin] : []),
  `http://localhost:${webPort}`,
  `http://127.0.0.1:${webPort}`,
  ...(env.EXTRA_ORIGINS?.split(",") ?? []),
];

/** Keeps the session signing key next to the data, created once and readable only by this user. */
function loadAuthSecret(): string {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  const path = `${dataDir}-auth-secret`;
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return readFileSync(path, "utf8");
}

/** Times for sections nobody has changed yet. An empty value means no scheduled alarms. */
function defaultAlarmTimes(): string[] {
  const value = env.WATERING_TIMES ?? "08:00,18:00";
  const times = normalizeAlarmTimes(value.split(",").map((time) => time.trim()).filter(Boolean));
  if (!times) throw new Error(`WATERING_TIMES must be HH:mm values separated by commas: ${value}`);
  return times;
}

const broker = await startBroker();
const database = await openDatabase(dataDir);
const app = await startApp({
  db: database.db,
  auth: createAuth({
    db: database.db,
    baseURL: webOrigins[0]!,
    secret: loadAuthSecret(),
    trustedOrigins: webOrigins,
  }),
  mqttUrl: `mqtt://127.0.0.1:${DEFAULT_MQTT_PORT}`,
  httpPort: DEFAULT_SOCKET_PORT,
  allowedOrigins: webOrigins,
  sessionSweepMs: 30_000,
  defaultAlarmTimes: defaultAlarmTimes(),
  enableDevRoutes: env.NODE_ENV !== "production",
  staleAfterMs: 15_000,
  tickMs: 1000,
  watering: {
    alarmEveryMs: env.ALARM_EVERY_MIN ? Number(env.ALARM_EVERY_MIN) * MINUTE : undefined,
    timeZone: env.TZ_NAME ?? "Asia/Seoul",
    durationSec: Number(env.WATERING_DURATION_SEC ?? 30),
    soilSufficientPct: SOIL_SUFFICIENT_PCT,
    remindAfterMs: Number(env.ALARM_REMIND_MIN ?? 10) * MINUTE,
    alarmTimeoutMs: Number(env.ALARM_TIMEOUT_MIN ?? 30) * MINUTE,
    ackTimeoutMs: 15_000,
    completionGraceMs: 15_000,
  },
});
console.log(`[server] MQTT broker on 127.0.0.1:${broker.port}, Socket.IO on 127.0.0.1:${DEFAULT_SOCKET_PORT}`);

const shutdown = async () => {
  // A stuck connection must never leave a background process running after Ctrl+C.
  setTimeout(() => process.exit(1), 3000).unref();
  await app.stop();
  await broker.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
