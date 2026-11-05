import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MQTT_PORT, DEFAULT_SOCKET_PORT, normalizeAlarmTimes, SOIL_SUFFICIENT_PCT } from "@terranova/shared";
import webpush from "web-push";
import { startApp } from "./app";
import { createAuth } from "./auth";
import { startBroker } from "./broker";
import { openDatabase } from "./db";
import type { PushConfig } from "./push";

const MINUTE = 60_000;
const env = process.env;
const webPort = env.WEB_PORT ?? "3000";
const backendPort = Number(env.BACKEND_PORT ?? DEFAULT_SOCKET_PORT);
const mqttPort = Number(env.MQTT_PORT ?? DEFAULT_MQTT_PORT);

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
  const times = normalizeAlarmTimes(
    value
      .split(",")
      .map((time) => time.trim())
      .filter(Boolean),
  );
  if (!times) throw new Error(`WATERING_TIMES must be HH:mm values separated by commas: ${value}`);
  return times;
}

/** Keys identifying this server to push services, created once beside the data. */
function loadPushKeys(): PushConfig {
  const path = `${dataDir}-push-keys.json`;
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 });
  }
  const { publicKey, privateKey } = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  return { publicKey: publicKey!, privateKey: privateKey!, subject: "https://github.com/ryushin01/TerraNova" };
}

const broker = await startBroker({ port: mqttPort });
const database = await openDatabase(dataDir);
const app = await startApp({
  db: database.db,
  auth: createAuth({
    db: database.db,
    baseURL: webOrigins[0]!,
    secret: loadAuthSecret(),
    trustedOrigins: webOrigins,
  }),
  mqttUrl: `mqtt://127.0.0.1:${mqttPort}`,
  httpPort: backendPort,
  allowedOrigins: webOrigins,
  sessionSweepMs: 30_000,
  defaultAlarmTimes: defaultAlarmTimes(),
  push: loadPushKeys(),
  sensorSampleMs: Number(env.SENSOR_SAMPLE_SEC ?? 60) * 1000,
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
console.log(`[server] MQTT broker on 127.0.0.1:${broker.port}, Socket.IO on 127.0.0.1:${backendPort}`);

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
