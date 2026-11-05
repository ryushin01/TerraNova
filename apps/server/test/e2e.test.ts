import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  AddCropResult,
  ClientToServerEvents,
  ConfirmResult,
  ControlResult,
  Crop,
  FarmSnapshot,
  HistoryEntry,
  HistoryPage,
  ServerToClientEvents,
  WateringCycle,
} from "@terranova/shared";
import { ZONE_IDS } from "@terranova/shared";
import { io, type Socket } from "socket.io-client";
import { startSimulator } from "../../simulator/src/simulator";
import { startApp } from "../src/app";
import { type Auth, createAuth } from "../src/auth";
import { startBroker } from "../src/broker";
import { openDatabase } from "../src/db";

const MQTT_PORT = 18831;
const HTTP_PORT = 14000;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const ORIGIN = "http://localhost:3000";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let broker: Awaited<ReturnType<typeof startBroker>>;
let database: Awaited<ReturnType<typeof openDatabase>>;
let app: Awaited<ReturnType<typeof startApp>>;
let simulator: ReturnType<typeof startSimulator>;
let socket: Client;
let auth: Auth;
let operatorCookie = "";
const PASSWORD = "correct-horse-battery";
const cycles: WateringCycle[] = [];
const pushed: { subscription: { endpoint: string }; payload: string }[] = [];

async function until<T>(find: () => T | undefined | null | false, timeoutMs = 8000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = find();
    if (value) return value;
    await Bun.sleep(20);
  }
  throw new Error("timed out");
}

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { ...jsonHeaders, ...headers }, body: JSON.stringify(body) });

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const response = await post("/api/auth/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

const connect = (cookie: string, autoConnect = true): Client =>
  io(BASE, { autoConnect, reconnection: false, extraHeaders: { origin: ORIGIN, cookie } });

const connectResult = (client: Client) =>
  new Promise<string>((resolve) => {
    client.once("connect", () => resolve("connected"));
    client.once("connect_error", (error) => resolve(error.message));
  });

const snapshotOf = (client: Client) => new Promise<FarmSnapshot>((resolve) => client.once("snapshot", resolve));

const confirm = (client: Client, id: string) =>
  new Promise<ConfirmResult>((resolve) => client.emit("alarm:confirm", id, resolve));

const triggerAlarm = (zone: string) => fetch(`${BASE}/dev/alarms/${zone}`, { method: "POST" });

beforeAll(async () => {
  broker = await startBroker({ port: MQTT_PORT });
  database = await openDatabase();
  auth = createAuth({
    db: database.db,
    baseURL: ORIGIN,
    secret: "test-secret-test-secret-test-secret",
    trustedOrigins: [ORIGIN],
  });
  app = await startApp({
    db: database.db,
    auth,
    sessionSweepMs: 100,
    defaultAlarmTimes: [],
    push: {
      publicKey: "test-public-key",
      privateKey: "test-private-key",
      subject: "https://example.com",
      send: async (subscription, payload) => {
        pushed.push({ subscription, payload });
      },
    },
    mqttUrl: `mqtt://127.0.0.1:${MQTT_PORT}`,
    httpPort: HTTP_PORT,
    allowedOrigins: [ORIGIN],
    enableDevRoutes: true,
    staleAfterMs: 2000,
    tickMs: 50,
    watering: {
      timeZone: "Asia/Seoul",
      durationSec: 2,
      soilSufficientPct: 101, // the simulator's soil is random, and this test needs watering to happen
      remindAfterMs: 60_000,
      alarmTimeoutMs: 120_000,
      ackTimeoutMs: 2000,
      completionGraceMs: 2000,
    },
  });
  simulator = startSimulator({ brokerUrl: `mqtt://127.0.0.1:${MQTT_PORT}`, tickMs: 50, telemetryMs: 100 });
  expect((await post("/api/setup", { name: "Admin", email: "admin@terranova.test", password: PASSWORD })).status).toBe(
    201,
  );
  const adminCookie = await signIn("admin@terranova.test");
  const created = await post(
    "/api/auth/admin/create-user",
    { name: "Operator", email: "op@terranova.test", password: PASSWORD, role: "operator" },
    { cookie: adminCookie },
  );
  expect(created.status).toBe(200);
  operatorCookie = await signIn("op@terranova.test");
  socket = io(BASE, { extraHeaders: { origin: ORIGIN, cookie: operatorCookie } });
  socket.on("cycle:update", (cycle) => cycles.push(cycle));
  await until(() => socket.connected);
});

afterAll(async () => {
  socket.close();
  await simulator.stop();
  await app.stop();
  await broker.stop();
  await database.close();
});

test("alarm to completion over real MQTT and sockets", async () => {
  const zones: Record<string, boolean> = {};
  socket.on("zone:update", (zone) => (zones[zone.zoneId] = zone.online && !!zone.telemetry));
  await until(() => zones["zone-a"]);

  expect((await triggerAlarm("zone-a")).status).toBe(201);
  expect((await triggerAlarm("zone-a")).status).toBe(409);
  const alarm = await until(() => cycles.find((c) => c.zoneId === "zone-a" && c.state === "alarm_sent"));

  const other = connect(operatorCookie);
  await until(() => other.connected);
  const results = await Promise.all([confirm(socket, alarm.id), confirm(other, alarm.id)]);
  other.close();
  expect(results.filter((r) => r.ok)).toHaveLength(1);

  await until(() => cycles.find((c) => c.id === alarm.id && c.state === "watering"));
  const done = await until(() => cycles.find((c) => c.id === alarm.id && c.state === "completed"));
  expect(done.reason).toBe("duration_elapsed");
  expect(done.startedAt).not.toBeNull();

  const seen = cycles.filter((c) => c.id === alarm.id).map((c) => c.state);
  expect(seen).toEqual(["alarm_sent", "confirmed", "command_sent", "watering", "completed"]);
});

test("a client that connects later still receives a waiting alarm", async () => {
  await triggerAlarm("zone-b");
  const late = connect(operatorCookie, false);
  const snapshot = snapshotOf(late);
  late.connect();
  const { cycles: latest, zones } = await snapshot;
  late.close();
  expect(latest.find((c) => c.zoneId === "zone-b")?.state).toBe("alarm_sent");
  expect(zones).toHaveLength(ZONE_IDS.length);
});

test("manual vent control follows the device and pump cannot be switched on directly", async () => {
  const vent = (on: boolean) =>
    new Promise<ControlResult>((resolve) => socket.emit("actuator:set", "zone-c", "vent", on, resolve));
  let reported: boolean | undefined;
  socket.on("zone:update", (zone) => {
    if (zone.zoneId === "zone-c") reported = zone.telemetry?.actuators.vent;
  });

  expect(await vent(true)).toEqual({ ok: true });
  await until(() => reported === true);
  expect(await vent(false)).toEqual({ ok: true });
  await until(() => reported === false);

  const pump = await new Promise<ControlResult>((resolve) =>
    socket.emit("actuator:set", "zone-c", "pump" as never, true, resolve),
  );
  expect(pump).toEqual({ ok: false, error: "invalid" });
});

test("stopping the pump ends watering early and is recorded as stopped", async () => {
  const stopCycles: WateringCycle[] = [];
  const onCycle = (cycle: WateringCycle) => {
    if (cycle.zoneId === "zone-d") stopCycles.push(cycle);
  };
  socket.on("cycle:update", onCycle);
  await triggerAlarm("zone-d");
  const alarm = await until(() => stopCycles.find((c) => c.state === "alarm_sent"));
  await confirm(socket, alarm.id);
  await until(() => stopCycles.find((c) => c.state === "watering"));

  const result = await new Promise<ControlResult>((resolve) => socket.emit("pump:stop", "zone-d", resolve));
  expect(result).toEqual({ ok: true });
  const done = await until(() => stopCycles.find((c) => c.state === "completed"));
  expect(done.reason).toBe("stopped_by_command");
  socket.off("cycle:update", onCycle);
});

test("moving zones and adding crops is shared with everyone and kept for new connections", async () => {
  const pushed = new Promise<Crop[]>((resolve) => socket.once("crops:update", resolve));
  const added = await new Promise<AddCropResult>((r) => socket.emit("crop:add", "토마토", "tomato", r));
  if (!added.ok) throw new Error(added.error);
  expect(added.crop).toMatchObject({ name: "토마토", icon: "tomato" });
  expect((await pushed).map((c) => c.name)).toContain("토마토");

  const moved = new Promise<Record<string, string>>((resolve) => socket.once("sections:update", resolve));
  expect(await new Promise((r) => socket.emit("zones:move", ["zone-e", "zone-f"], added.crop.id, r))).toEqual({
    ok: true,
  });
  expect((await moved)["zone-f"]).toBe(added.crop.id);

  expect(await new Promise((r) => socket.emit("crop:remove", added.crop.id, r))).toEqual({
    ok: false,
    error: "not_empty",
  });

  const late = connect(operatorCookie, false);
  const snapshot = snapshotOf(late);
  late.connect();
  const { sections, crops } = await snapshot;
  late.close();
  expect(sections["zone-e"]).toBe(added.crop.id);
  expect(sections["zone-a"]).toBe("bellflower");
  expect(crops.map((c) => c.name)).toContain("토마토");

  for (const [ids, crop] of [
    [[], "rice"],
    [["nope"], "rice"],
    ["zone-a", "rice"],
    [["zone-a"], "cactus"],
    [["zone-a"], 7],
  ] as const) {
    expect(await new Promise((r) => socket.emit("zones:move", ids as never, crop as never, r))).toEqual({
      ok: false,
      error: "invalid",
    });
  }
  expect(await new Promise((r) => socket.emit("crop:add", "", "tomato", r))).toEqual({ ok: false, error: "invalid" });
});

test("saving alarm times reaches everyone, and bad values are refused", async () => {
  const pushed = new Promise<Crop[]>((resolve) => socket.once("crops:update", resolve));
  expect(await new Promise((r) => socket.emit("crop:schedule", "lettuce", ["23:59", "00:00"], r))).toEqual({
    ok: true,
  });
  expect((await pushed).find((c) => c.id === "lettuce")?.alarmTimes).toEqual(["00:00", "23:59"]);

  expect(await new Promise((r) => socket.emit("crop:schedule", "lettuce", ["25:00"], r))).toEqual({
    ok: false,
    error: "invalid",
  });
  expect(await new Promise((r) => socket.emit("crop:schedule", "lettuce", "08:00" as never, r))).toEqual({
    ok: false,
    error: "invalid",
  });
  expect(await new Promise((r) => socket.emit("crop:schedule", 7 as never, [], r))).toEqual({
    ok: false,
    error: "invalid",
  });
  expect(await new Promise((r) => socket.emit("crop:schedule", "nope", [], r))).toEqual({
    ok: false,
    error: "invalid",
  });
});

test("another website cannot open the control socket", async () => {
  const evil: Client = io(BASE, {
    extraHeaders: { origin: "https://evil.example", cookie: operatorCookie },
    reconnection: false,
    transports: ["websocket"],
  });
  const outcome = await new Promise((resolve) => {
    evil.once("connect", () => resolve("connected"));
    evil.once("connect_error", () => resolve("refused"));
  });
  evil.close();
  expect(outcome).toBe("refused");
});

describe("access", () => {
  test("no public sign-up, and setup works only once", async () => {
    expect(
      (await post("/api/auth/sign-up/email", { name: "X", email: "x@terranova.test", password: PASSWORD })).status,
    ).not.toBe(200);
    expect((await post("/api/setup", { name: "X", email: "x@terranova.test", password: PASSWORD })).status).toBe(409);
    expect(await (await fetch(`${BASE}/api/setup`)).json()).toEqual({ needsSetup: false });
    expect((await post("/api/auth/sign-in/email", { email: "x@terranova.test", password: PASSWORD })).status).toBe(401);
  });

  test("setup refuses requests without an allowed Origin", async () => {
    const body = JSON.stringify({ name: "X", email: "x@terranova.test", password: PASSWORD });
    const headers = { "content-type": "application/json" };
    expect((await fetch(`${BASE}/api/setup`, { method: "POST", headers, body })).status).toBe(403);
    expect(
      (
        await fetch(`${BASE}/api/setup`, {
          method: "POST",
          headers: { ...headers, origin: "http://192.168.0.9:3000" },
          body,
        })
      ).status,
    ).toBe(403);
  });

  test("a socket without a valid session is refused", async () => {
    for (const cookie of ["", "better-auth.session_token=forged.value"]) {
      const client = connect(cookie);
      expect(await connectResult(client)).toBe("unauthorized");
      client.close();
    }
  });

  test("a viewer can watch but every control is refused", async () => {
    const admin = await signIn("admin@terranova.test");
    await post(
      "/api/auth/admin/create-user",
      { name: "V", email: "viewer@terranova.test", password: PASSWORD, role: "viewer" },
      { cookie: admin },
    );
    const viewer = connect(await signIn("viewer@terranova.test"), false);
    const snapshot = snapshotOf(viewer);
    viewer.connect();
    expect((await snapshot).zones).toHaveLength(ZONE_IDS.length);
    expect(await new Promise((r) => viewer.emit("zones:move", ["zone-a"], "rice", r))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await new Promise((r) => viewer.emit("crop:add", "토마토", "tomato", r))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await new Promise((r) => viewer.emit("crop:remove", "rice", r))).toEqual({ ok: false, error: "forbidden" });
    expect(await new Promise((r) => viewer.emit("crop:schedule", "rice", ["05:00"], r))).toEqual({
      ok: false,
      error: "forbidden",
    });

    const forbidden = { ok: false, error: "forbidden" };
    expect(await new Promise((r) => viewer.emit("pump:stop", "zone-a", r))).toEqual(forbidden);
    expect(await new Promise((r) => viewer.emit("actuator:set", "zone-a", "vent", true, r))).toEqual(forbidden);
    await triggerAlarm("zone-a");
    const alarm = await until(() => cycles.findLast((c) => c.zoneId === "zone-a" && c.state === "alarm_sent"));
    expect(await confirm(viewer, alarm.id)).toEqual(forbidden);
    expect(await new Promise((r) => viewer.emit("watering:start", "zone-a", r))).toEqual(forbidden);
    viewer.close();
  });

  test("non-admins cannot manage users", async () => {
    const response = await post(
      "/api/auth/admin/create-user",
      { name: "Y", email: "y@terranova.test", password: PASSWORD, role: "admin" },
      { cookie: operatorCookie },
    );
    expect(response.status).toBe(403);
    expect(
      (await fetch(`${BASE}/api/auth/admin/list-users`, { headers: { origin: ORIGIN, cookie: operatorCookie } }))
        .status,
    ).toBe(403);
  });

  test("passwords reset by an admin follow the same length rule", async () => {
    const admin = await signIn("admin@terranova.test");
    const made = await post(
      "/api/auth/admin/create-user",
      { name: "P", email: "p@terranova.test", password: PASSWORD, role: "viewer" },
      { cookie: admin },
    );
    const userId = ((await made.json()) as { user: { id: string } }).user.id;
    expect(
      (await post("/api/auth/admin/set-user-password", { userId, newPassword: "short" }, { cookie: admin })).status,
    ).toBe(400);
    expect((await post("/api/auth/sign-in/email", { email: "p@terranova.test", password: PASSWORD })).status).toBe(200);
    expect(
      (
        await post(
          "/api/auth/admin/set-user-password",
          { userId, newPassword: "another-password-1" },
          { cookie: admin },
        )
      ).status,
    ).toBe(200);
    expect((await post("/api/auth/sign-in/email", { email: "p@terranova.test", password: PASSWORD })).status).toBe(401);
    expect(
      (await post("/api/auth/sign-in/email", { email: "p@terranova.test", password: "another-password-1" })).status,
    ).toBe(200);
  });

  test("changing your own password needs the current one and a real new one", async () => {
    const admin = await signIn("admin@terranova.test");
    await post(
      "/api/auth/admin/create-user",
      { name: "C", email: "c@terranova.test", password: PASSWORD, role: "viewer" },
      { cookie: admin },
    );
    const cookie = await signIn("c@terranova.test");
    const change = (currentPassword: string, newPassword: string) =>
      post("/api/auth/change-password", { currentPassword, newPassword }, { cookie });
    expect((await change("wrong-password-1", "another-password-1")).status).not.toBe(200);
    expect((await change(PASSWORD, "short")).status).not.toBe(200);
    expect((await change(PASSWORD, "another-password-1")).status).toBe(200);
    expect(
      (await post("/api/auth/sign-in/email", { email: "c@terranova.test", password: "another-password-1" })).status,
    ).toBe(200);
  });

  test("admin-created accounts must have a real password", async () => {
    const admin = await signIn("admin@terranova.test");
    const response = await post(
      "/api/auth/admin/create-user",
      { name: "Z", email: "z@terranova.test", password: "short", role: "viewer" },
      { cookie: admin },
    );
    expect(response.status).not.toBe(200);
  });

  test("a role change applies to an open connection immediately", async () => {
    const admin = await signIn("admin@terranova.test");
    const made = await post(
      "/api/auth/admin/create-user",
      { name: "R", email: "r@terranova.test", password: PASSWORD, role: "operator" },
      { cookie: admin },
    );
    const userId = (await made.json()).user.id;
    const client = connect(await signIn("r@terranova.test"));
    await until(() => client.connected);
    await post("/api/auth/admin/set-role", { userId, role: "viewer" }, { cookie: admin });
    expect(await new Promise((r) => client.emit("pump:stop", "zone-a", r))).toEqual({ ok: false, error: "forbidden" });
    client.close();
  });

  test("signing out disconnects an open page", async () => {
    const admin = await signIn("admin@terranova.test");
    await post(
      "/api/auth/admin/create-user",
      { name: "S", email: "s@terranova.test", password: PASSWORD, role: "viewer" },
      { cookie: admin },
    );
    const cookie = await signIn("s@terranova.test");
    const client = connect(cookie);
    await until(() => client.connected);
    await post("/api/auth/sign-out", {}, { cookie });
    await until(() => !client.connected);
    client.close();
  });
});

describe("control history", () => {
  const read = (cookie: string, query = "") =>
    fetch(`${BASE}/api/history${query}`, { headers: { origin: ORIGIN, cookie } });
  const entries = async (query = ""): Promise<HistoryEntry[]> =>
    ((await (await read(operatorCookie, query)).json()) as HistoryPage).entries;

  /** Records are written on the side, so they can take a moment to appear. */
  async function firstEntry(query: string, match: (entry: HistoryEntry) => boolean): Promise<HistoryEntry> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = (await entries(query)).find(match);
      if (found) return found;
      await Bun.sleep(20);
    }
    throw new Error(`no matching history entry for ${query}`);
  }

  test("device control records the person, the zone and what the device said", async () => {
    expect(await new Promise((r) => socket.emit("actuator:set", "zone-d", "light", true, r))).toEqual({ ok: true });
    const entry = await firstEntry("?action=actuator_set&zone=zone-d", (e) => e.detail.actuator === "light");
    expect(entry).toMatchObject({
      actorName: "Operator",
      actorRole: "operator",
      zoneId: "zone-d",
      detail: { actuator: "light", on: true },
      result: "ok",
    });
    await new Promise((r) => socket.emit("actuator:set", "zone-d", "light", false, r));
  });

  test("watering, stopping, moving and crop changes are all recorded", async () => {
    await new Promise((r) => socket.emit("watering:start", "zone-d", r));
    await new Promise((r) => socket.emit("pump:stop", "zone-d", r));
    expect((await firstEntry("?action=watering_start&zone=zone-d", () => true)).result).toBe("sent");
    expect((await firstEntry("?action=pump_stop&zone=zone-d", () => true)).result).toBe("ok");

    const added = await new Promise<AddCropResult>((r) => socket.emit("crop:add", "감자", "potato", r));
    if (!added.ok) throw new Error(added.error);
    await new Promise((r) => socket.emit("crop:schedule", added.crop.id, ["06:00"], r));
    await new Promise((r) => socket.emit("zones:move", ["zone-c", "zone-d"], added.crop.id, r));
    await firstEntry("?action=zones_move&zone=zone-c", (e) => e.detail.crop?.name === "감자");
    await firstEntry("?action=zones_move&zone=zone-d", (e) => e.detail.crop?.name === "감자");
    await new Promise((r) => socket.emit("zones:move", ["zone-c", "zone-d"], "rice", r));
    await new Promise((r) => socket.emit("crop:remove", added.crop.id, r));

    expect((await firstEntry("?action=crop_add", (e) => e.detail.crop?.name === "감자")).result).toBe("ok");
    const times = await firstEntry("?action=alarm_times", (e) => e.detail.crop?.name === "감자");
    expect(times.detail.times).toEqual(["06:00"]);
    // The name survives the crop being deleted.
    expect((await firstEntry("?action=crop_remove", (e) => e.detail.crop?.name === "감자")).result).toBe("ok");
  });

  test("refused attempts are recorded too, and failures keep their reason", async () => {
    const admin = await signIn("admin@terranova.test");
    await post(
      "/api/auth/admin/create-user",
      { name: "Refused", email: "refused@terranova.test", password: PASSWORD, role: "viewer" },
      { cookie: admin },
    );
    const viewer = connect(await signIn("refused@terranova.test"));
    await until(() => viewer.connected);
    await new Promise((r) => viewer.emit("pump:stop", "zone-a", r));
    viewer.close();
    expect(await firstEntry("?action=pump_stop&zone=zone-a", (e) => e.actorName === "Refused")).toMatchObject({
      actorRole: "viewer",
      result: "forbidden",
    });

    await new Promise((r) => socket.emit("crop:remove", "bellflower", r));
    expect((await firstEntry("?action=crop_remove", (e) => e.detail.crop?.id === "bellflower")).result).toBe(
      "not_empty",
    );
  });

  test("records outlive the account", async () => {
    const admin = await signIn("admin@terranova.test");
    const made = await post(
      "/api/auth/admin/create-user",
      { name: "Temp Worker", email: "tempworker@terranova.test", password: PASSWORD, role: "operator" },
      { cookie: admin },
    );
    const userId = ((await made.json()) as { user: { id: string } }).user.id;
    const worker = connect(await signIn("tempworker@terranova.test"));
    await until(() => worker.connected);
    await new Promise((r) => worker.emit("actuator:set", "zone-e", "vent", true, r));
    worker.close();
    await firstEntry("?action=actuator_set&zone=zone-e", (e) => e.actorName === "Temp Worker");

    expect((await post("/api/auth/admin/remove-user", { userId }, { cookie: admin })).status).toBe(200);
    await firstEntry("?action=actuator_set&zone=zone-e", (e) => e.actorName === "Temp Worker");
  });

  test("crop edits and reordering are recorded with the old name", async () => {
    const added = await new Promise<AddCropResult>((r) => socket.emit("crop:add", "수정전", "sprout", r));
    if (!added.ok) throw new Error(added.error);
    const updated = await new Promise<AddCropResult>((r) =>
      socket.emit("crop:update", added.crop.id, "수정후", "tomato", r),
    );
    expect(updated).toMatchObject({ ok: true, crop: { name: "수정후", icon: "tomato" } });
    const entry = await firstEntry("?action=crop_edit", (e) => e.detail.previousName === "수정전");
    expect(entry.detail.crop?.name).toBe("수정후");

    const crops = await new Promise<Crop[]>((resolve) => {
      socket.once("crops:update", resolve);
      socket.emit("crop:update", added.crop.id, "수정후", "corn", () => {});
    });
    const ids = crops.map((c) => c.id);
    expect(await new Promise((r) => socket.emit("crops:reorder", [...ids].reverse(), r))).toEqual({ ok: true });
    expect((await firstEntry("?action=crops_reorder", () => true)).result).toBe("ok");
    expect(await new Promise((r) => socket.emit("crops:reorder", ["nope"], r))).toEqual({
      ok: false,
      error: "invalid",
    });
    await new Promise((r) => socket.emit("crops:reorder", ids, r));
    await new Promise((r) => socket.emit("crop:remove", added.crop.id, r));
  });

  test("password changes record who and whose, and never the password", async () => {
    const admin = await signIn("admin@terranova.test");
    const made = await post(
      "/api/auth/admin/create-user",
      { name: "Target", email: "target@terranova.test", password: PASSWORD, role: "operator" },
      { cookie: admin },
    );
    const userId = ((await made.json()) as { user: { id: string } }).user.id;

    const secret = "brand-new-password-77";
    expect(
      (await post("/api/auth/admin/set-user-password", { userId, newPassword: secret }, { cookie: admin })).status,
    ).toBe(200);
    const reset = await firstEntry("?action=password_reset", (e) => e.detail.target === "Target" && e.result === "ok");
    expect(reset.actorName).toBe("Admin");
    expect(JSON.stringify(reset)).not.toContain(secret);

    const target = await signIn("target@terranova.test", secret);
    await post(
      "/api/auth/admin/set-user-password",
      { userId, newPassword: "tried-by-non-admin-1" },
      { cookie: target },
    );
    await firstEntry("?action=password_reset", (e) => e.actorName === "Target" && e.result === "forbidden");

    expect(
      (
        await post(
          "/api/auth/change-password",
          { currentPassword: "wrong-password-1", newPassword: "another-password-2" },
          { cookie: target },
        )
      ).status,
    ).not.toBe(200);
    await firstEntry("?action=password_change", (e) => e.actorName === "Target" && e.result === "failed");

    const changed = "changed-by-owner-3";
    expect(
      (
        await post(
          "/api/auth/change-password",
          { currentPassword: secret, newPassword: changed, revokeOtherSessions: true },
          { cookie: target },
        )
      ).status,
    ).toBe(200);
    const own = await firstEntry("?action=password_change", (e) => e.actorName === "Target" && e.result === "ok");
    expect(own.actorRole).toBe("operator");
    expect(JSON.stringify(await entries("?limit=100"))).not.toContain(changed);
  });

  test("only admins and operators can read it, and bad queries are refused", async () => {
    expect((await read("")).status).toBe(401);
    expect((await read("better-auth.session_token=forged.value")).status).toBe(401);
    expect((await read(await signIn("viewer@terranova.test"))).status).toBe(403);
    expect((await read(operatorCookie)).status).toBe(200);
    expect((await read(await signIn("admin@terranova.test"))).status).toBe(200);
    expect(
      (await fetch(`${BASE}/api/history`, { method: "POST", headers: { origin: ORIGIN, cookie: operatorCookie } }))
        .status,
    ).toBe(405);

    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=x",
      "?before=-1",
      "?before=1e99",
      "?zone=nope",
      "?action=nope",
      "?zone=%27%20OR%201=1",
    ]) {
      expect((await read(operatorCookie, query)).status, query).toBe(400);
    }
  });

  test("pages hold the requested size and report where to continue", async () => {
    const page = (await (await read(operatorCookie, "?limit=2")).json()) as HistoryPage;
    expect(page.entries).toHaveLength(2);
    expect(page.nextBefore).toBe(page.entries[1]!.id);
    expect(page.timeZone).toBe("Asia/Seoul");
    const next = (await (await read(operatorCookie, `?limit=2&before=${page.nextBefore}`)).json()) as HistoryPage;
    expect(next.entries[0]!.id).toBeLessThan(page.nextBefore!);
  });
});

describe("push subscriptions", () => {
  const FCM = "https://fcm.googleapis.com/fcm/send/e2e";
  const body = { endpoint: FCM, keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) }, locale: "ko" };
  const anonymous = (path: string, method = "POST") =>
    fetch(`${BASE}${path}`, {
      method,
      headers: jsonHeaders,
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });

  test("an alarm reaches a subscribed browser", async () => {
    expect(
      (
        (await (
          await fetch(`${BASE}/api/push/key`, { headers: { origin: ORIGIN, cookie: operatorCookie } })
        ).json()) as { publicKey: string }
      ).publicKey,
    ).toBe("test-public-key");
    expect((await post("/api/push/subscribe", body, { cookie: operatorCookie })).status).toBe(204);
    pushed.length = 0;
    await triggerAlarm("zone-f");
    await until(() => pushed.find((p) => p.subscription.endpoint === FCM && JSON.parse(p.payload).tag === "zone-F"));
    expect((await post("/api/push/unsubscribe", { endpoint: FCM }, { cookie: operatorCookie })).status).toBe(204);
  });

  test("needs a signed-in person, a known origin and a real push service", async () => {
    expect((await anonymous("/api/push/subscribe")).status).toBe(401);
    expect((await anonymous("/api/push/key", "GET")).status).toBe(401);
    expect(
      (
        await fetch(`${BASE}/api/push/subscribe`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: operatorCookie },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    expect(
      (await post("/api/push/subscribe", body, { cookie: operatorCookie, origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/api/push/subscribe",
          { ...body, endpoint: "https://169.254.169.254/x" },
          { cookie: operatorCookie },
        )
      ).status,
    ).toBe(400);
    expect(
      (await post("/api/push/unsubscribe", { endpoint: "https://evil.example/x" }, { cookie: operatorCookie })).status,
    ).toBe(400);
  });
});

test("rejects bad input from clients without crashing", async () => {
  expect(await confirm(socket, "not-a-uuid")).toEqual({ ok: false, error: "not_found" });
  expect((await triggerAlarm("nope")).status).toBe(400);
  expect(
    (await fetch(`${BASE}/dev/alarms/zone-c`, { method: "POST", headers: { origin: "https://evil.example" } })).status,
  ).toBe(403);
  expect((await fetch(`${BASE}/unknown`)).status).toBe(404);
  expect(socket.connected).toBe(true);
});
