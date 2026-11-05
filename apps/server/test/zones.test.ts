import { expect, test } from "bun:test";
import type { Telemetry } from "@terranova/shared";
import { ZoneRegistry } from "../src/zones";

const telemetry: Telemetry = {
  zoneId: "zone-a",
  timestamp: "2026-11-05T00:00:00.000Z",
  temperatureC: 24,
  humidityPct: 60,
  soilMoisturePct: 40,
  actuators: { pump: false, vent: false, light: false },
};

test("a zone is online only while live telemetry keeps arriving", () => {
  const zones = new ZoneRegistry(15_000);
  expect(zones.isOnline("zone-a", 0)).toBe(false);
  zones.recordTelemetry("zone-a", telemetry, 0);
  expect(zones.isOnline("zone-a", 15_000)).toBe(true);
  expect(zones.isOnline("zone-a", 15_001)).toBe(false);
});

test("retained telemetry shows the last reading but does not mean the device is alive", () => {
  const zones = new ZoneRegistry(15_000);
  zones.recordStatus("zone-a", false, 0);
  const snapshot = zones.recordTelemetry("zone-a", telemetry, 0, true);
  expect(snapshot.telemetry?.soilMoisturePct).toBe(40);
  expect(snapshot.online).toBe(false);
});

test("a retained online status alone does not mean the device is alive", () => {
  const zones = new ZoneRegistry(15_000);
  expect(zones.recordStatus("zone-a", true, 0).online).toBe(false);
});

test("an offline status takes effect immediately", () => {
  const zones = new ZoneRegistry(15_000);
  zones.recordTelemetry("zone-a", telemetry, 0);
  expect(zones.recordStatus("zone-a", false, 1).online).toBe(false);
});

test("reports a zone that went silent exactly once", () => {
  const zones = new ZoneRegistry(15_000);
  zones.recordTelemetry("zone-a", telemetry, 0);
  expect(zones.sweepStale(15_000)).toEqual([]);
  expect(zones.sweepStale(15_001).map((z) => z.online)).toEqual([false]);
  expect(zones.sweepStale(15_002)).toEqual([]);
});
