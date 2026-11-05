import { describe, expect, test } from "bun:test";
import { MAX_PUMP_DURATION_SEC, parseCommand } from "@terranova/shared";
import { ZoneDevice } from "../src/device";

const device = (pumpFailRate = 0) =>
  new ZoneDevice({ zoneId: "zone-a", pumpFailRate, random: () => 0.5 });

describe("pump safety", () => {
  test("stops at the requested duration and reports completion", () => {
    const d = device();
    expect(d.handleCommand("pump", { commandId: "c1", action: "on", durationSec: 10 }, 0)[0]?.status).toBe("accepted");
    expect(d.tick(1, 9_999)).toEqual([]);
    expect(d.telemetry(9_999).actuators.pump).toBe(true);

    const [ack] = d.tick(1, 10_000);
    expect(ack).toMatchObject({ commandId: "c1", status: "completed", reason: "duration_elapsed" });
    expect(d.telemetry(10_000).actuators.pump).toBe(false);
  });

  test.each([undefined, MAX_PUMP_DURATION_SEC * 10])("limits a duration of %p to the maximum", (durationSec) => {
    const d = device();
    d.handleCommand("pump", { commandId: "c1", action: "on", durationSec }, 0);
    const maxMs = MAX_PUMP_DURATION_SEC * 1000;
    expect(d.tick(1, maxMs - 1)).toEqual([]);
    expect(d.tick(1, maxMs)[0]?.status).toBe("completed");
  });

  test("a retried command id does not restart the pump or extend the run", () => {
    const d = device();
    const command = { commandId: "c1", action: "on", durationSec: 10 } as const;
    d.handleCommand("pump", command, 0);
    expect(d.handleCommand("pump", command, 5_000)[0]?.status).toBe("accepted");
    expect(d.tick(1, 10_000)[0]?.status).toBe("completed");

    expect(d.handleCommand("pump", command, 11_000)[0]?.status).toBe("completed");
    expect(d.telemetry(11_000).actuators.pump).toBe(false);
  });

  test("rejects a different command while the pump is running", () => {
    const d = device();
    d.handleCommand("pump", { commandId: "c1", action: "on", durationSec: 10 }, 0);
    expect(d.handleCommand("pump", { commandId: "c2", action: "on", durationSec: 10 }, 1_000)[0]).toMatchObject({
      status: "rejected",
      reason: "already_running",
    });
    expect(d.tick(1, 10_000)[0]?.commandId).toBe("c1");
  });

  test("off stops the pump and completes both commands", () => {
    const d = device();
    d.handleCommand("pump", { commandId: "c1", action: "on", durationSec: 10 }, 0);
    const acks = d.handleCommand("pump", { commandId: "c2", action: "off" }, 1_000);
    expect(acks.map((a) => [a.commandId, a.status])).toEqual([["c1", "completed"], ["c2", "completed"]]);
    expect(d.telemetry(1_000).actuators.pump).toBe(false);
  });

  test("a pump fault reports failure and leaves the pump off", () => {
    const d = device(1);
    expect(d.handleCommand("pump", { commandId: "c1", action: "on" }, 0)[0]).toMatchObject({
      status: "failed",
      reason: "pump_fault",
    });
    expect(d.telemetry(0).actuators.pump).toBe(false);
  });
});

test("watering raises soil moisture and values stay in range", () => {
  const d = device();
  const before = d.telemetry(0).soilMoisturePct;
  d.handleCommand("pump", { commandId: "c1", action: "on", durationSec: 300 }, 0);
  for (let i = 1; i <= 200; i++) d.tick(1, i * 1000);
  const after = d.telemetry(200_000);
  expect(after.soilMoisturePct).toBeGreaterThan(before);
  expect(after.soilMoisturePct).toBeLessThanOrEqual(100);
});

describe("parseCommand", () => {
  test("accepts a valid command", () => {
    expect(parseCommand('{"commandId":"c1","action":"on","durationSec":5}')).toEqual({
      commandId: "c1",
      action: "on",
      durationSec: 5,
    });
  });

  test.each(["not json", "null", '{"action":"on"}', '{"commandId":"c","action":"open"}', '{"commandId":"c","action":"on","durationSec":-1}'])(
    "rejects %s",
    (payload) => expect(parseCommand(payload)).toBeNull(),
  );
});
