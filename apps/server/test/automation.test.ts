import { beforeEach, describe, expect, test } from "bun:test";
import { type AutomationRules, type ControlResult, normalizeAutomation, type Telemetry } from "@terranova/shared";
import { Automation, desiredLight, desiredVent } from "../src/automation";

const OFF: AutomationRules = {
  ventOnAboveC: null,
  ventOffBelowC: null,
  lightOnAt: null,
  lightOffAt: null,
  soilAlarmBelowPct: null,
};

const reading = (over: Partial<Telemetry> = {}, actuators: Partial<Telemetry["actuators"]> = {}): Telemetry => ({
  zoneId: "zone-a",
  timestamp: "",
  temperatureC: 25,
  humidityPct: 60,
  soilMoisturePct: 50,
  actuators: { pump: false, vent: false, light: false, ...actuators },
  ...over,
});

describe("rule decisions", () => {
  const vent = { ...OFF, ventOnAboveC: 30, ventOffBelowC: 25 };
  test.each([
    [31, true],
    [30, true],
    [29.9, null],
    [25.1, null],
    [25, false],
    [20, false],
  ])("at %p°C the vent wants %p", (temperature, expected) => {
    expect(desiredVent(vent, temperature)).toBe(expected);
  });

  const at = (hour: number, minute = 0) => hour * 60 + minute;
  test.each([
    ["08:00", "18:00", at(7, 59), false],
    ["08:00", "18:00", at(8), true],
    ["08:00", "18:00", at(17, 59), true],
    ["08:00", "18:00", at(18), false],
    ["22:00", "06:00", at(23), true],
    ["22:00", "06:00", at(3), true],
    ["22:00", "06:00", at(6), false],
    ["22:00", "06:00", at(12), false],
  ])("lights %s to %s at minute %p: %p", (lightOnAt, lightOffAt, minutes, expected) => {
    expect(desiredLight({ ...OFF, lightOnAt, lightOffAt }, minutes)).toBe(expected);
  });

  test("unset rules leave things alone", () => {
    expect(desiredVent(OFF, 99)).toBeNull();
    expect(desiredLight(OFF, 100)).toBeNull();
  });
});

describe("validating rules", () => {
  test("accepts complete rules and blank ones", () => {
    expect(normalizeAutomation(OFF)).toEqual(OFF);
    const full = {
      ventOnAboveC: 30,
      ventOffBelowC: 25,
      lightOnAt: "08:00",
      lightOffAt: "18:00",
      soilAlarmBelowPct: 30,
    };
    expect(normalizeAutomation(full)).toEqual(full);
  });

  test.each([
    [{ ventOnAboveC: 25, ventOffBelowC: 25 }],
    [{ ventOnAboveC: 20, ventOffBelowC: 25 }],
    [{ ventOnAboveC: 30 }],
    [{ ventOffBelowC: 25 }],
    [{ ventOnAboveC: 999, ventOffBelowC: 25 }],
    [{ ventOnAboveC: "30", ventOffBelowC: 25 }],
    [{ lightOnAt: "08:00" }],
    [{ lightOnAt: "25:00", lightOffAt: "18:00" }],
    [{ lightOnAt: "08:00", lightOffAt: "08:00" }],
    [{ soilAlarmBelowPct: -1 }],
    [{ soilAlarmBelowPct: 70 }],
  ])("refuses %j", (partial) => {
    expect(normalizeAutomation({ ...OFF, ...partial })).toBeNull();
  });

  test.each([[null], ["x"], [[]], [7]])("refuses %j", (value) => expect(normalizeAutomation(value)).toBeNull());
});

describe("running rules", () => {
  let rules: AutomationRules | null;
  let current: Telemetry | null;
  let commands: [string, boolean][];
  let alarms: string[];
  let switched: ControlResult[];
  let response: ControlResult;
  let automation: Automation;

  beforeEach(() => {
    rules = { ...OFF, ventOnAboveC: 30, ventOffBelowC: 25 };
    current = reading({ temperatureC: 31 });
    commands = [];
    alarms = [];
    switched = [];
    response = { ok: true };
    automation = new Automation({
      schedule: async () => [{ zoneId: "zone-a", rules }],
      liveReading: () => current,
      setActuator: async (_zone, actuator, on) => {
        commands.push([actuator, on]);
        return response;
      },
      raiseAlarm: async (_zone, slot) => {
        alarms.push(slot);
      },
      onSwitched: (_zone, _actuator, _on, result) => switched.push(result),
      localMinutes: () => 12 * 60,
    });
  });

  test("switches when a rule calls for it, and reports what the device said", async () => {
    await automation.tick(0);
    expect(commands).toEqual([["vent", true]]);
    expect(switched).toEqual([{ ok: true }]);
  });

  test("does nothing when the device already matches", async () => {
    current = reading({ temperatureC: 31 }, { vent: true });
    await automation.tick(0);
    expect(commands).toEqual([]);
  });

  test("an unresponsive device isn't sent a command every tick", async () => {
    response = { ok: false, error: "no_ack" };
    await automation.tick(0);
    await automation.tick(1000);
    await automation.tick(59_999);
    expect(commands).toHaveLength(1);
    await automation.tick(60_000);
    expect(commands).toHaveLength(2);
  });

  test("a manual change holds the rule for 30 minutes, then it applies again", async () => {
    automation.noteManualChange("zone-a", "vent", 0);
    await automation.tick(1000);
    await automation.tick(30 * 60_000 - 1);
    expect(commands).toEqual([]);
    await automation.tick(30 * 60_000);
    expect(commands).toEqual([["vent", true]]);
  });

  test("holds can be read while they last, and disappear afterwards", () => {
    expect(automation.pauses(0)).toEqual({});
    automation.noteManualChange("zone-a", "vent", 0);
    expect(automation.pauses(1000)).toEqual({ "zone-a|vent": new Date(30 * 60_000).toISOString() });
    expect(automation.pauses(30 * 60_000)).toEqual({});
  });

  test("offline zones and sections without rules are skipped", async () => {
    current = null;
    await automation.tick(0);
    current = reading({ temperatureC: 31 });
    rules = null;
    await automation.tick(100_000);
    expect(commands).toEqual([]);
  });

  test("dry soil raises one alarm per period, and never waters", async () => {
    rules = { ...OFF, soilAlarmBelowPct: 30 };
    current = reading({ soilMoisturePct: 20 });
    await automation.tick(0);
    await automation.tick(60_000);
    expect(new Set(alarms).size).toBe(1);
    await automation.tick(6 * 60 * 60_000);
    expect(new Set(alarms).size).toBe(2);
    expect(commands).toEqual([]);

    current = reading({ soilMoisturePct: 30 });
    alarms = [];
    await automation.tick(12 * 60 * 60_000);
    expect(alarms).toEqual([]);
  });

  test("no rule can ever command the pump", async () => {
    rules = { ventOnAboveC: 30, ventOffBelowC: 25, lightOnAt: "08:00", lightOffAt: "18:00", soilAlarmBelowPct: 60 };
    current = reading({ temperatureC: 40, soilMoisturePct: 1 });
    await automation.tick(0);
    expect(commands.map(([actuator]) => actuator).sort()).toEqual(["light", "vent"]);
  });
});
