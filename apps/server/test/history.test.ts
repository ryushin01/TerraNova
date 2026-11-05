import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { openDatabase } from "../src/db";
import { controlEvents } from "../src/db/schema";
import { ControlHistory, outcomeOf, type Actor } from "../src/history";

const OPERATOR: Actor = { id: "u1", name: "김작업", role: "operator" };

let database: Awaited<ReturnType<typeof openDatabase>>;
let history: ControlHistory;

beforeEach(async () => {
  database = await openDatabase();
  history = new ControlHistory(database.db);
});

afterEach(() => database.close());

test("records who did what, newest first", async () => {
  await history.record(OPERATOR, [{ action: "pump_stop", zoneId: "zone-a", result: "ok" }]);
  await history.record({ id: "u2", name: "이조회", role: "viewer" }, [
    { action: "actuator_set", zoneId: "zone-b", detail: { actuator: "vent", on: true }, result: "forbidden" },
  ]);

  const { entries, nextBefore } = await history.list({ limit: 10 });
  expect(nextBefore).toBeNull();
  expect(entries.map((e) => [e.actorName, e.actorRole, e.action, e.zoneId, e.result])).toEqual([
    ["이조회", "viewer", "actuator_set", "zone-b", "forbidden"],
    ["김작업", "operator", "pump_stop", "zone-a", "ok"],
  ]);
  expect(entries[0]?.detail).toEqual({ actuator: "vent", on: true });
  expect(Number.isNaN(Date.parse(entries[0]!.at))).toBe(false);
});

test("pages through everything without repeating", async () => {
  for (let index = 0; index < 5; index++) {
    await history.record(OPERATOR, [{ action: "pump_stop", zoneId: `zone-${index}`, result: "ok" }]);
  }
  const first = await history.list({ limit: 2 });
  const second = await history.list({ limit: 2, before: first.nextBefore! });
  const third = await history.list({ limit: 2, before: second.nextBefore! });
  expect([...first.entries, ...second.entries, ...third.entries].map((e) => e.zoneId)).toEqual([
    "zone-4",
    "zone-3",
    "zone-2",
    "zone-1",
    "zone-0",
  ]);
  expect(third.nextBefore).toBeNull();
});

test("filters by zone and by action", async () => {
  await history.record(OPERATOR, [
    { action: "pump_stop", zoneId: "zone-a", result: "ok" },
    { action: "watering_start", zoneId: "zone-a", result: "sent" },
    { action: "pump_stop", zoneId: "zone-b", result: "ok" },
    { action: "crop_add", detail: { crop: { id: "c", name: "토마토" } }, result: "ok" },
  ]);
  expect((await history.list({ limit: 10, zoneId: "zone-a" })).entries).toHaveLength(2);
  expect((await history.list({ limit: 10, action: "pump_stop" })).entries).toHaveLength(2);
  expect((await history.list({ limit: 10, zoneId: "zone-a", action: "pump_stop" })).entries).toHaveLength(1);
  expect((await history.list({ limit: 10, action: "crop_add" })).entries[0]?.zoneId).toBeNull();
});

test("records past 90 days are removed and newer ones stay", async () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const row = (at: string, zoneId: string) => ({
    at: new Date(at),
    actorId: "u",
    actorName: "n",
    actorRole: "operator",
    action: "pump_stop" as const,
    zoneId,
    detail: {},
    result: "ok",
  });
  await database.db.insert(controlEvents).values([
    row("2026-08-06T23:59:00Z", "old"),
    row("2026-08-07T00:01:00Z", "kept"),
  ]);
  await history.prune(now);
  expect((await history.list({ limit: 10 })).entries.map((e) => e.zoneId)).toEqual(["kept"]);
});

test("a failed write is logged and never reaches the caller", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const broken = new ControlHistory({
    insert: () => {
      throw new Error("disk full");
    },
  } as never);
  await broken.record(OPERATOR, [{ action: "pump_stop", result: "ok" }]);
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});

test("outcomes describe where a request ended up", () => {
  const cycle = (state: string, reason: string | null = null) => ({ state, reason }) as never;
  expect(outcomeOf({ ok: true })).toEqual({ result: "ok" });
  expect(outcomeOf({ ok: true, cycle: cycle("command_sent") })).toEqual({ result: "sent", reason: null });
  expect(outcomeOf({ ok: true, cycle: cycle("skipped", "soil_sufficient") })).toEqual({
    result: "skipped",
    reason: "soil_sufficient",
  });
  expect(outcomeOf({ ok: false, error: "forbidden" })).toEqual({ result: "forbidden" });
});
