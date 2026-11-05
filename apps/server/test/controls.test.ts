import { beforeEach, expect, test } from "bun:test";
import { type CommandAck, parseCommand, type Telemetry, topics } from "@terranova/shared";
import { DeviceControls } from "../src/controls";
import { ZoneRegistry } from "../src/zones";

const telemetry: Telemetry = {
  zoneId: "zone-a",
  timestamp: "2026-11-05T00:00:00.000Z",
  temperatureC: 24,
  humidityPct: 60,
  soilMoisturePct: 40,
  actuators: { pump: true, vent: false, light: false },
};

let zones: ZoneRegistry;
let sent: { topic: string; payload: string }[];
let publishFails: boolean;
let controls: DeviceControls;

const ack = (status: CommandAck["status"]): CommandAck => ({
  commandId: parseCommand(sent.at(-1)!.payload)!.commandId,
  zoneId: "zone-a",
  actuator: "pump",
  status,
  timestamp: telemetry.timestamp,
});

beforeEach(() => {
  zones = new ZoneRegistry(15_000);
  sent = [];
  publishFails = false;
  controls = new DeviceControls({
    zones,
    ackTimeoutMs: 40,
    now: () => 0,
    publish: async (topic, payload) => {
      if (publishFails) throw new Error("down");
      sent.push({ topic, payload });
    },
  });
});

test("manual switching refuses an offline zone without sending anything", async () => {
  expect(await controls.setActuator("zone-a", "vent", true)).toEqual({ ok: false, error: "zone_offline" });
  expect(sent).toHaveLength(0);
});

test("manual switching succeeds only when the device confirms", async () => {
  zones.recordTelemetry("zone-a", telemetry, 0);
  const result = controls.setActuator("zone-a", "light", true);
  expect(sent[0]!.topic).toBe(topics.command("zone-a", "light"));
  expect(parseCommand(sent[0]!.payload)?.action).toBe("on");
  controls.handleAck(ack("completed"));
  expect(await result).toEqual({ ok: true });
});

test("a device failure and a silent device are both reported", async () => {
  zones.recordTelemetry("zone-a", telemetry, 0);
  const failed = controls.setActuator("zone-a", "vent", true);
  controls.handleAck(ack("failed"));
  expect(await failed).toEqual({ ok: false, error: "device_failed" });
  expect(await controls.setActuator("zone-a", "vent", true)).toEqual({ ok: false, error: "no_ack" });
});

test("stop is still sent to a zone we believe is offline", async () => {
  expect(await controls.stopPump("zone-a")).toEqual({ ok: false, error: "zone_offline" });
  expect(sent).toHaveLength(1);
  expect(parseCommand(sent[0]!.payload)?.action).toBe("off");
});

test("stop reports success when the device confirms", async () => {
  zones.recordTelemetry("zone-a", telemetry, 0);
  const result = controls.stopPump("zone-a");
  controls.handleAck(ack("completed"));
  expect(await result).toEqual({ ok: true });
});

test("a publish failure is reported immediately", async () => {
  zones.recordTelemetry("zone-a", telemetry, 0);
  publishFails = true;
  expect(await controls.stopPump("zone-a")).toEqual({ ok: false, error: "internal" });
});
