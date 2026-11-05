import type { SensorPoint, SensorRange, Telemetry } from "@terranova/shared";
import { SENSOR_RANGES } from "@terranova/shared";
import { lt, sql } from "drizzle-orm";
import type { Database } from "./db";
import { sensorSamples } from "./db/schema";

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Keeps a reading per zone at a fixed interval: live values arrive far too often to store them all. */
export class SensorHistory {
  private readonly lastSampleMs = new Map<string, number>();

  constructor(
    private readonly db: Database,
    private readonly sampleMs: number,
  ) {}

  /** Never throws: recording history must not disturb live updates. */
  async record(telemetry: Telemetry, nowMs: number): Promise<void> {
    const last = this.lastSampleMs.get(telemetry.zoneId);
    if (last !== undefined && nowMs - last < this.sampleMs) return;
    this.lastSampleMs.set(telemetry.zoneId, nowMs);
    try {
      await this.db.insert(sensorSamples).values({
        zoneId: telemetry.zoneId,
        at: new Date(nowMs),
        temperatureC: telemetry.temperatureC,
        humidityPct: telemetry.humidityPct,
        soilMoisturePct: telemetry.soilMoisturePct,
      });
    } catch (error) {
      console.error("[sensors] could not record:", error);
    }
  }

  /** Averages per time bucket, oldest first. Buckets without data are simply absent. */
  async series(zoneId: string, range: SensorRange, nowMs: number): Promise<SensorPoint[]> {
    const { spanMs, bucketMs } = SENSOR_RANGES[range];
    const bucketSec = bucketMs / 1000;
    const result = await this.db.execute(sql`
      SELECT floor(extract(epoch FROM ${sensorSamples.at}) / ${bucketSec}::double precision) * ${bucketSec}::double precision AS bucket,
             avg(${sensorSamples.temperatureC}) AS temperature,
             avg(${sensorSamples.humidityPct}) AS humidity,
             avg(${sensorSamples.soilMoisturePct}) AS soil
      FROM ${sensorSamples}
      WHERE ${sensorSamples.zoneId} = ${zoneId} AND ${sensorSamples.at} >= ${new Date(nowMs - spanMs).toISOString()}::timestamptz
      GROUP BY bucket
      ORDER BY bucket`);
    return (result.rows as Record<string, unknown>[]).map((row) => ({
      at: new Date(Number(row.bucket) * 1000).toISOString(),
      temperatureC: Number(row.temperature),
      humidityPct: Number(row.humidity),
      soilMoisturePct: Number(row.soil),
    }));
  }

  async prune(now = new Date()): Promise<void> {
    await this.db.delete(sensorSamples).where(lt(sensorSamples.at, new Date(now.getTime() - RETENTION_DAYS * DAY_MS)));
  }
}
