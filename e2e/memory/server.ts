/**
 * Repeats identical load on the real backend and reports memory after forced garbage collection.
 * Steady growth per round after warm-up would mean a leak. A deliberate leak at the end proves
 * the measurement can see one. The simulator's command cache (1,000 per zone) fills up first,
 * so "cycles" needs about 500 rounds to level off.
 *
 *   bun e2e/memory/server.ts [idle|churn|commands|cycles|moves|http|all] [rounds]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZONE_IDS, type ClientToServerEvents, type ServerToClientEvents } from "@terranova/shared";
import { io, type Socket } from "socket.io-client";
import { startApp } from "../../apps/server/src/app";
import { createAuth } from "../../apps/server/src/auth";
import { startBroker } from "../../apps/server/src/broker";
import { openDatabase } from "../../apps/server/src/db";
import { startSimulator } from "../../apps/simulator/src/simulator";

const mode = process.argv[2] ?? "all";
const rounds = Number(process.argv[3] ?? 100);
const ORIGIN = "http://localhost:3000";
const HTTP_PORT = 14100;
const MQTT_PORT = 18850;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const MQTT = `mqtt://127.0.0.1:${MQTT_PORT}`;
const PASSWORD = "correct-horse-battery";
const dataRoot = mkdtempSync(join(tmpdir(), "terranova-memory-"));

const broker = await startBroker({ port: MQTT_PORT });
const database = await openDatabase(join(dataRoot, "db"));
const auth = createAuth({ db: database.db, baseURL: ORIGIN, secret: crypto.randomUUID().repeat(2), trustedOrigins: [ORIGIN] });
const app = await startApp({
  db: database.db,
  auth,
  mqttUrl: MQTT,
  httpPort: HTTP_PORT,
  allowedOrigins: [ORIGIN],
  enableDevRoutes: true,
  staleAfterMs: 5000,
  tickMs: 50,
  sessionSweepMs: 200,
  sensorSampleMs: 100,
  defaultAlarmTimes: [],
  watering: {
    timeZone: "Asia/Seoul",
    durationSec: 1,
    soilSufficientPct: 101,
    remindAfterMs: 60_000,
    alarmTimeoutMs: 120_000,
    ackTimeoutMs: 2000,
    completionGraceMs: 2000,
  },
});
const simulator = startSimulator({ brokerUrl: MQTT, tickMs: 50, telemetryMs: 10 });

const headers = { origin: ORIGIN, "content-type": "application/json" };
await fetch(`${BASE}/api/setup`, { method: "POST", headers, body: JSON.stringify({ name: "a", email: "a@t.test", password: PASSWORD }) });
const signedIn = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email: "a@t.test", password: PASSWORD }) });
const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const connect = (): Client => io(BASE, { reconnection: false, forceNew: true, extraHeaders: { origin: ORIGIN, cookie } });
const connected = (client: Client) =>
  new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("connect_error", reject);
  });

const main = connect();
await connected(main);
await Bun.sleep(1000);
const timed = () => main.timeout(5000);

// Rules on, so automation and sensor recording are part of what's measured on every tick.
await timed().emitWithAck("crop:automation", "bellflower", {
  ventOnAboveC: 5,
  ventOffBelowC: 1,
  lightOnAt: "00:00",
  lightOffAt: "23:59",
  soilAlarmBelowPct: null,
});
let cropNumber = 0;

const loads: Record<string, () => Promise<void>> = {
  idle: () => Bun.sleep(1300),
  async churn() {
    for (let index = 0; index < 60; index++) {
      const client = connect();
      await connected(client);
      client.close();
    }
  },
  async commands() {
    for (let index = 0; index < 100; index++) {
      await timed().emitWithAck("actuator:set", ZONE_IDS[index % ZONE_IDS.length]!, "vent", index % 2 === 0);
    }
  },
  async cycles() {
    for (const zone of ZONE_IDS) {
      await fetch(`${BASE}/dev/alarms/${zone}`, { method: "POST" });
      await timed().emitWithAck("watering:start", zone);
    }
    await Bun.sleep(100);
    for (const zone of ZONE_IDS) await timed().emitWithAck("pump:stop", zone);
    await Bun.sleep(100);
  },
  async moves() {
    for (let index = 0; index < 30; index++) {
      await timed().emitWithAck("zones:move", ["zone-a", "zone-b"], index % 2 ? "rice" : "bellflower");
    }
    const added = await timed().emitWithAck("crop:add", `작물${++cropNumber}`, "sprout");
    if (added.ok) await timed().emitWithAck("crop:remove", added.crop.id);
  },
  async http() {
    for (let index = 0; index < 20; index++) {
      await fetch(`${BASE}/api/auth/get-session`, { headers: { origin: ORIGIN, cookie } });
    }
  },
};

const round = async () => {
  if (mode !== "all") return loads[mode]!();
  for (const [name, load] of Object.entries(loads)) if (name !== "idle") await load();
};

const { heapStats } = await import("bun:jsc");
const sample = async () => {
  await Bun.sleep(300);
  Bun.gc(true);
  await Bun.sleep(100);
  Bun.gc(true);
  const memory = process.memoryUsage();
  return { heap: memory.heapUsed / 1048576, rss: memory.rss / 1048576, objects: heapStats().objectCount };
};

// Plain typed arrays, so recording a sample doesn't itself grow the heap being measured.
const heap = new Float64Array(rounds);
const objects = new Float64Array(rounds);
const rss = new Float64Array(rounds);
for (let index = 0; index < rounds; index++) {
  await round();
  const now = await sample();
  heap[index] = now.heap;
  objects[index] = now.objects;
  rss[index] = now.rss;
  if ((index + 1) % Math.max(1, Math.floor(rounds / 10)) === 0) {
    console.log(`round ${index + 1}: heap ${now.heap.toFixed(1)}MB, objects ${now.objects}, rss ${now.rss.toFixed(0)}MB`);
  }
}

const from = Math.floor(rounds * 0.6);
const span = rounds - 1 - from;
const perRound = (values: Float64Array) => (values[rounds - 1]! - values[from]!) / span;
console.log(`\nafter warm-up, per round: heap ${perRound(heap).toFixed(4)}MB, objects ${perRound(objects).toFixed(1)}, rss ${perRound(rss).toFixed(3)}MB`);
console.log(`messages queued while offline: ${simulator.queuedMessages()}`);

const leak = Array.from({ length: 200_000 }, (_, index) => ({ index, text: `x${index}` }));
const control = await sample();
console.log(`control, 200k objects held on purpose: heap ${heap[rounds - 1]!.toFixed(1)}MB -> ${control.heap.toFixed(1)}MB (${leak.length})`);

main.close();
await simulator.stop();
await app.stop();
await broker.stop();
await database.close();
rmSync(dataRoot, { recursive: true, force: true });
process.exit(0);
