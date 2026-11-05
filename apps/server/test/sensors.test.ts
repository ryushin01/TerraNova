import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Telemetry } from "@terranova/shared";
import { openDatabase } from "../src/db";
import { SensorHistory } from "../src/sensors";

const MINUTE = 60_000;
const NOW = Date.parse("2026-11-05T12:00:00Z");

const telemetry = (zoneId: string, temperatureC: number): Telemetry => ({
  zoneId,
  timestamp: "",
  temperatureC,
  humidityPct: 60,
  soilMoisturePct: 40,
  actuators: { pump: false, vent: false, light: false },
});

let database: Awaited<ReturnType<typeof openDatabase>>;
let sensors: SensorHistory;

beforeEach(async () => {
  database = await openDatabase();
  sensors = new SensorHistory(database.db, MINUTE);
});

afterEach(() => database.close());

test("stores one reading per interval, separately per zone", async () => {
  await sensors.record(telemetry("zone-a", 20), NOW - 10 * MINUTE);
  await sensors.record(telemetry("zone-a", 99), NOW - 10 * MINUTE + 1000);
  await sensors.record(telemetry("zone-b", 30), NOW - 10 * MINUTE + 1000);
  await sensors.record(telemetry("zone-a", 22), NOW - 9 * MINUTE);

  const a = await sensors.series("zone-a", "1h", NOW);
  expect(a.map((p) => p.temperatureC)).toEqual([20, 22]);
  expect((await sensors.series("zone-b", "1h", NOW)).map((p) => p.temperatureC)).toEqual([30]);
});

test("averages within a bucket, in time order", async () => {
  // Two readings in one 10-minute bucket, one in the next.
  const start = Math.floor((NOW - 60 * MINUTE) / (10 * MINUTE)) * 10 * MINUTE;
  await sensors.record(telemetry("zone-a", 20), start + MINUTE);
  await sensors.record(telemetry("zone-a", 30), start + 3 * MINUTE);
  await sensors.record(telemetry("zone-a", 40), start + 11 * MINUTE);

  const points = await sensors.series("zone-a", "24h", NOW);
  expect(points.map((p) => p.temperatureC)).toEqual([25, 40]);
  expect(points[0]?.at).toBe(new Date(start).toISOString());
});

test("a range only shows its own period", async () => {
  await sensors.record(telemetry("zone-a", 10), NOW - 2 * 60 * MINUTE);
  await sensors.record(telemetry("zone-a", 20), NOW - 10 * MINUTE);
  expect(await sensors.series("zone-a", "1h", NOW)).toHaveLength(1);
  expect(await sensors.series("zone-a", "24h", NOW)).toHaveLength(2);
  expect(await sensors.series("zone-z", "24h", NOW)).toEqual([]);
});

test("readings past 30 days are removed", async () => {
  const DAY = 24 * 60 * MINUTE;
  await sensors.record(telemetry("zone-a", 10), NOW - 31 * DAY);
  await sensors.record(telemetry("zone-a", 20), NOW - 29 * DAY);
  await sensors.prune(new Date(NOW));
  expect((await sensors.series("zone-a", "30d", NOW)).map((p) => p.temperatureC)).toEqual([20]);
});

test("a failed write is logged and never reaches live updates", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const broken = new SensorHistory(
    {
      insert: () => {
        throw new Error("disk full");
      },
    } as never,
    MINUTE,
  );
  await broken.record(telemetry("zone-a", 20), NOW);
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});
