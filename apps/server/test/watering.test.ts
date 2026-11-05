import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { canTransition, parseCommand, topics, type WateringCycle } from "@terranova/shared";
import { openDatabase } from "../src/db";
import { WateringService, dueSlots, localMinutes, type WateringConfig } from "../src/watering";
import { ZoneRegistry } from "../src/zones";

const MINUTE = 60_000;
const START = new Date("2026-11-05T00:00:00Z"); // 09:00 in Seoul

const config: WateringConfig = {
  timeZone: "Asia/Seoul",
  durationSec: 30,
  soilSufficientPct: 70,
  remindAfterMs: 10 * MINUTE,
  alarmTimeoutMs: 30 * MINUTE,
  ackTimeoutMs: 15_000,
  completionGraceMs: 15_000,
};

let database: Awaited<ReturnType<typeof openDatabase>>;
let nowMs: number;
let zones: ZoneRegistry;
let published: { topic: string; payload: string }[];
let events: WateringCycle[];
let publishFails: boolean;

const now = () => new Date(nowMs);

interface ServiceOptions extends Partial<WateringConfig> {
  zoneIds?: string[];
  times?: string[];
  updatedAtMs?: number;
}

function service({ zoneIds = ["zone-a", "zone-b"], times = [], updatedAtMs = 0, ...overrides }: ServiceOptions = {}) {
  return new WateringService({
    db: database.db,
    zones,
    config: { ...config, ...overrides },
    schedule: async () => zoneIds.map((zoneId) => ({ zoneId, times, updatedAtMs })),
    now,
    publish: async (topic, payload) => {
      if (publishFails) throw new Error("broker down");
      published.push({ topic, payload });
    },
    onCycleChange: (cycle) => events.push(cycle),
  });
}

function reportZone(zoneId: string, soilMoisturePct: number) {
  zones.recordTelemetry(
    zoneId,
    {
      zoneId,
      timestamp: now().toISOString(),
      temperatureC: 24,
      humidityPct: 60,
      soilMoisturePct,
      actuators: { pump: false, vent: false, light: false },
    },
    nowMs,
  );
}

const ack = (commandId: string, status: "accepted" | "completed" | "failed" | "rejected", reason?: string) => ({
  commandId,
  zoneId: "zone-a",
  actuator: "pump" as const,
  status,
  reason,
  timestamp: now().toISOString(),
});

const lastState = async (s: WateringService, zoneId = "zone-a") =>
  (await s.latestCycles()).find((c) => c.zoneId === zoneId);

const pumpCommands = () => published.map((p) => parseCommand(p.payload)!);

/** Runs a confirmed cycle up to the point where the device has been told to start. */
async function confirmedCycle(s: WateringService) {
  reportZone("zone-a", 40);
  const alarm = (await s.triggerAlarm("zone-a"))!;
  const result = await s.confirm(alarm.id);
  if (!result.ok) throw new Error(result.error);
  return { cycle: result.cycle, commandId: pumpCommands()[0]!.commandId };
}

beforeEach(async () => {
  database = await openDatabase();
  nowMs = START.getTime();
  zones = new ZoneRegistry(15_000);
  published = [];
  events = [];
  publishFails = false;
});

afterEach(() => database.close());

describe("confirming an alarm", () => {
  test("sends exactly one pump command with the configured duration", async () => {
    const s = service();
    const { cycle } = await confirmedCycle(s);
    expect(cycle.state).toBe("command_sent");
    expect(published).toHaveLength(1);
    expect(published[0]!.topic).toBe(topics.command("zone-a", "pump"));
    expect(pumpCommands()[0]).toMatchObject({ action: "on", durationSec: 30 });
  });

  test("simultaneous confirmations start the pump only once", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const alarm = (await s.triggerAlarm("zone-a"))!;
    const results = await Promise.all(Array.from({ length: 5 }, () => s.confirm(alarm.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "already_handled")).toHaveLength(4);
    expect(published).toHaveLength(1);
  });

  test("two services cannot both win, as after a restart overlap", async () => {
    reportZone("zone-a", 40);
    const alarm = (await service().triggerAlarm("zone-a"))!;
    const results = await Promise.all([service().confirm(alarm.id), service().confirm(alarm.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  test("skips watering when the soil is already wet", async () => {
    const s = service();
    reportZone("zone-a", 75);
    const alarm = (await s.triggerAlarm("zone-a"))!;
    const result = await s.confirm(alarm.id);
    expect(result).toMatchObject({ ok: true, cycle: { state: "skipped", reason: "soil_sufficient" } });
    expect(published).toHaveLength(0);
  });

  test("does not send to an offline zone", async () => {
    const s = service();
    const alarm = (await s.triggerAlarm("zone-a"))!;
    expect(await s.confirm(alarm.id)).toMatchObject({ ok: true, cycle: { state: "failed", reason: "zone_offline" } });
    expect(published).toHaveLength(0);
  });

  test("treats a zone with old telemetry as offline", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const alarm = (await s.triggerAlarm("zone-a"))!;
    nowMs += 16_000;
    expect(await s.confirm(alarm.id)).toMatchObject({ ok: true, cycle: { state: "failed", reason: "zone_offline" } });
    expect(published).toHaveLength(0);
  });

  test("reports failure when the command cannot be published", async () => {
    const s = service();
    reportZone("zone-a", 40);
    publishFails = true;
    const alarm = (await s.triggerAlarm("zone-a"))!;
    expect(await s.confirm(alarm.id)).toMatchObject({ ok: true, cycle: { state: "failed", reason: "publish_failed" } });
  });

  test("refuses an expired alarm even before the next tick", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const alarm = (await s.triggerAlarm("zone-a"))!;
    nowMs += 30 * MINUTE;
    reportZone("zone-a", 40);
    expect(await s.confirm(alarm.id)).toEqual({ ok: false, error: "already_handled" });
    expect(published).toHaveLength(0);
  });

  test("returns not_found for an unknown cycle", async () => {
    expect(await service().confirm("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "not_found" });
  });
});

describe("watering started by a person", () => {
  test("runs with no alarm and finishes from device reports", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const result = await s.startWatering("zone-a", "user-1");
    expect(result).toMatchObject({ ok: true, cycle: { state: "command_sent" } });
    expect(events.map((e) => e.state)).not.toContain("alarm_sent");
    const { commandId } = pumpCommands()[0]!;
    await s.handleAck(ack(commandId, "accepted"));
    await s.handleAck(ack(commandId, "completed", "duration_elapsed"));
    expect((await lastState(s))?.state).toBe("completed");
  });

  test("answers a waiting alarm instead of creating a second cycle", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const alarm = (await s.triggerAlarm("zone-a"))!;
    expect(await s.startWatering("zone-a")).toMatchObject({ ok: true, cycle: { id: alarm.id, state: "command_sent" } });
    expect(published).toHaveLength(1);
  });

  test("cannot start twice, even at the same moment", async () => {
    const s = service();
    reportZone("zone-a", 40);
    const results = await Promise.all(Array.from({ length: 5 }, () => s.startWatering("zone-a")));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(await s.startWatering("zone-a")).toEqual({ ok: false, error: "already_handled" });
  });

  test("keeps the wet-soil and offline protections", async () => {
    const s = service();
    reportZone("zone-a", 80);
    expect(await s.startWatering("zone-a")).toMatchObject({ ok: true, cycle: { state: "skipped", reason: "soil_sufficient" } });
    expect(await s.startWatering("zone-b")).toMatchObject({ ok: true, cycle: { state: "failed", reason: "zone_offline" } });
    expect(published).toHaveLength(0);
  });

  test("is covered by the no-response deadline", async () => {
    const s = service();
    reportZone("zone-a", 40);
    await s.startWatering("zone-a");
    nowMs += 15_001;
    await s.tick();
    expect(await lastState(s)).toMatchObject({ state: "failed", reason: "no_ack" });
    expect(pumpCommands().map((c) => c.action)).toEqual(["on", "off"]);
  });
});

describe("device reports decide the outcome", () => {
  test("clicking alone never shows watering or completed", async () => {
    const s = service();
    await confirmedCycle(s);
    expect((await lastState(s))?.state).toBe("command_sent");
    expect(events.map((e) => e.state)).not.toContain("watering");
  });

  test("accepted then completed", async () => {
    const s = service();
    const { commandId } = await confirmedCycle(s);
    await s.handleAck(ack(commandId, "accepted"));
    expect((await lastState(s))?.state).toBe("watering");
    await s.handleAck(ack(commandId, "completed", "duration_elapsed"));
    expect(await lastState(s)).toMatchObject({ state: "completed", reason: "duration_elapsed" });
  });

  test("completed arriving before accepted still ends as completed", async () => {
    const s = service();
    const { commandId } = await confirmedCycle(s);
    await s.handleAck(ack(commandId, "completed"));
    await s.handleAck(ack(commandId, "accepted"));
    expect((await lastState(s))?.state).toBe("completed");
  });

  test.each([["failed", "pump_fault"], ["rejected", "already_running"]] as const)("%s ack fails the cycle", async (status, reason) => {
    const s = service();
    const { commandId } = await confirmedCycle(s);
    await s.handleAck(ack(commandId, status, reason));
    expect(await lastState(s)).toMatchObject({ state: "failed", reason });
  });

  test("ignores acks for unknown commands", async () => {
    const s = service();
    await confirmedCycle(s);
    await s.handleAck(ack("someone-else", "completed"));
    expect((await lastState(s))?.state).toBe("command_sent");
  });
});

describe("deadlines", () => {
  test("no ack: fails and tells the pump to stop", async () => {
    const s = service();
    await confirmedCycle(s);
    nowMs += 15_001;
    await s.tick();
    expect(await lastState(s)).toMatchObject({ state: "failed", reason: "no_ack" });
    expect(pumpCommands().map((c) => c.action)).toEqual(["on", "off"]);
  });

  test("late accepted after a failure does not revive the cycle", async () => {
    const s = service();
    const { commandId } = await confirmedCycle(s);
    nowMs += 15_001;
    await s.tick();
    await s.handleAck(ack(commandId, "accepted"));
    expect((await lastState(s))?.state).toBe("failed");
  });

  test("no completion: fails and stops only after duration plus grace", async () => {
    const s = service();
    const { commandId } = await confirmedCycle(s);
    await s.handleAck(ack(commandId, "accepted"));
    nowMs += 45_000;
    await s.tick();
    expect((await lastState(s))?.state).toBe("watering");
    nowMs += 1;
    await s.tick();
    expect(await lastState(s)).toMatchObject({ state: "failed", reason: "no_completion" });
    expect(pumpCommands().map((c) => c.action)).toEqual(["on", "off"]);
  });

  test("a stop is only sent once across repeated ticks", async () => {
    const s = service();
    await confirmedCycle(s);
    nowMs += 15_001;
    await s.tick();
    await s.tick();
    expect(pumpCommands().map((c) => c.action)).toEqual(["on", "off"]);
  });
});

describe("an unanswered alarm", () => {
  test("reminds, then times out without ever watering", async () => {
    const s = service();
    reportZone("zone-a", 10);
    await s.triggerAlarm("zone-a");

    nowMs += 10 * MINUTE;
    await s.tick();
    expect((await lastState(s))?.reminderCount).toBe(1);
    await s.tick();
    expect((await lastState(s))?.reminderCount).toBe(1);

    nowMs += 10 * MINUTE;
    await s.tick();
    expect((await lastState(s))?.reminderCount).toBe(2);

    nowMs += 10 * MINUTE;
    await s.tick();
    expect(await lastState(s)).toMatchObject({ state: "timed_out", reason: "alarm_unanswered" });
    expect(published).toHaveLength(0);
    expect(events.at(-1)?.state).toBe("timed_out");
  });
});

describe("schedule", () => {
  test("alarms each zone once per slot, across repeated ticks and a restart", async () => {
    const options = { times: ["09:00"], zoneIds: ["zone-a", "zone-b"] };
    await service(options).tick();
    await service(options).tick();
    const cycles = await service(options).latestCycles();
    expect(cycles.map((c) => [c.zoneId, c.state])).toEqual([["zone-a", "alarm_sent"], ["zone-b", "alarm_sent"]]);
    expect(events).toHaveLength(2);
  });

  test("records a skip instead of alarming when the soil is wet", async () => {
    const s = service({ times: ["09:00"] });
    reportZone("zone-a", 80);
    await s.tick();
    expect(await lastState(s)).toMatchObject({ state: "skipped", reason: "soil_sufficient" });
    expect((await lastState(s, "zone-b"))?.state).toBe("alarm_sent");
  });

  test("repeating demo alarms fire once per interval", async () => {
    const s = service({ alarmEveryMs: MINUTE, zoneIds: ["zone-a"] });
    await s.tick();
    await s.tick();
    expect(events.filter((e) => e.state === "alarm_sent")).toHaveLength(1);
    const alarm = (await lastState(s))!;
    reportZone("zone-a", 90);
    await s.confirm(alarm.id);
    await s.tick();
    expect((await lastState(s))?.state).toBe("skipped");
    nowMs += MINUTE;
    reportZone("zone-a", 40);
    await s.tick();
    expect((await lastState(s))?.state).toBe("alarm_sent");
  });

  test("a second alarm cannot start while one is active", async () => {
    const s = service();
    expect(await s.triggerAlarm("zone-a")).not.toBeNull();
    expect(await s.triggerAlarm("zone-a")).toBeNull();
    expect(await s.triggerAlarm("zone-b")).not.toBeNull();
  });

  test("dueSlots uses the farm's time zone and ignores slots past their window", () => {
    const slots = (timeZone: string, time: string) =>
      dueSlots(START, timeZone, [time], 30 * MINUTE).map(({ slot }) => slot);
    expect(slots("Asia/Seoul", "09:00")).toEqual(["2026-11-05T09:00"]);
    expect(slots("UTC", "09:00")).toEqual([]);
    expect(slots("Asia/Seoul", "09:01")).toEqual([]);
    expect(slots("Asia/Seoul", "08:30")).toEqual([]);
    expect(slots("Asia/Seoul", "08:31")).toEqual(["2026-11-05T08:31"]);
    expect(dueSlots(START, "Asia/Seoul", ["08:50"], 30 * MINUTE)[0]?.startedMs).toBe(START.getTime() - 10 * MINUTE);
  });

  test("a restart recovers an alarm missed earlier in its window", async () => {
    nowMs += 10 * MINUTE;
    await service({ times: ["09:00"], updatedAtMs: START.getTime() - 60 * MINUTE }).tick();
    expect((await lastState(service()))?.state).toBe("alarm_sent");
  });

  test("a time that had already passed when saved waits for tomorrow", async () => {
    nowMs += 10 * MINUTE;
    await service({ times: ["09:00"], updatedAtMs: nowMs }).tick();
    expect(events).toHaveLength(0);

    nowMs += 24 * 60 * MINUTE - 10 * MINUTE;
    await service({ times: ["09:00"], updatedAtMs: START.getTime() + 10 * MINUTE }).tick();
    expect((await lastState(service()))?.state).toBe("alarm_sent");
  });

  test("a time saved ahead of its minute alarms when it arrives", async () => {
    const saved = nowMs - 30_000;
    await service({ times: ["09:00"], updatedAtMs: saved }).tick();
    expect((await lastState(service()))?.state).toBe("alarm_sent");
  });

  test("zones can have different times", async () => {
    const s = new WateringService({
      db: database.db,
      zones,
      config,
      now,
      publish: async () => {},
      onCycleChange: (cycle) => events.push(cycle),
      schedule: async () => [
        { zoneId: "zone-a", times: ["09:00"], updatedAtMs: 0 },
        { zoneId: "zone-b", times: ["18:00"], updatedAtMs: 0 },
        { zoneId: "zone-c", times: [], updatedAtMs: 0 },
      ],
    });
    await s.tick();
    expect(events.map((e) => e.zoneId)).toEqual(["zone-a"]);
  });
});

describe("cleaning up old cycles", () => {
  const DAY = 24 * 60 * MINUTE;

  test("removes finished cycles past 90 days, keeping newer ones and anything in progress", async () => {
    const s = service();
    reportZone("zone-a", 90);
    const finished = (await s.triggerAlarm("zone-a"))!;
    await s.confirm(finished.id);
    await s.triggerAlarm("zone-b");

    nowMs += 89 * DAY;
    await s.prune();
    expect((await s.latestCycles()).map((c) => c.zoneId)).toEqual(["zone-a", "zone-b"]);

    nowMs += 2 * DAY;
    await s.prune();
    expect((await s.latestCycles()).map((c) => [c.zoneId, c.state])).toEqual([["zone-b", "alarm_sent"]]);
  });
});

test("localMinutes follows the time zone", () => {
  expect(localMinutes(START.getTime(), "Asia/Seoul")).toBe(9 * 60);
  expect(localMinutes(START.getTime(), "UTC")).toBe(0);
});

test("a restart keeps the cycle: a new service finishes it from stored state", async () => {
  const before = service();
  const { commandId } = await confirmedCycle(before);
  await before.handleAck(ack(commandId, "accepted"));

  const after = service();
  expect((await lastState(after))?.state).toBe("watering");
  await after.handleAck(ack(commandId, "completed"));
  expect((await lastState(after))?.state).toBe("completed");
});

test("the transition table allows no way out of a finished cycle", () => {
  for (const state of ["completed", "failed", "timed_out", "skipped"] as const) {
    expect(canTransition(state, "watering")).toBe(false);
  }
  expect(canTransition("alarm_sent", "watering")).toBe(false);
  expect(canTransition("alarm_sent", "command_sent")).toBe(false);
});
