import {
  DEFAULT_ZONE_CROPS,
  ZONE_IDS,
  isCropIconKey,
  normalizeAlarmTimes,
  suggestCropIcon,
  type Crop,
  type CropIconKey,
} from "@terranova/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "./db";
import type { ZoneSchedule } from "./watering";
import { crops, zoneSections } from "./db/schema";

const MAX_CROP_NAME_LENGTH = 30;
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  for (let current: any = error; current; current = current.cause) {
    if (current.code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

export type AddCropOutcome = { crop: Crop } | { error: "invalid" | "duplicate" };
export type RemoveCropOutcome = "ok" | "not_found" | "not_empty";

/** Crops and which section each zone belongs to. A section is one crop's group of zones. */
export class ZoneSections {
  constructor(
    private readonly db: Database,
    private readonly defaultAlarmTimes: readonly string[] = [],
  ) {}

  /** Gives every zone a section. Zones already placed are left where they are. */
  async init(): Promise<void> {
    await this.db
      .insert(zoneSections)
      .values(ZONE_IDS.map((zoneId) => ({ zoneId, crop: DEFAULT_ZONE_CROPS[zoneId] })))
      .onConflictDoNothing();
  }

  async crops(): Promise<Crop[]> {
    const rows = await this.db.select().from(crops).orderBy(asc(crops.createdAt), asc(crops.id));
    return rows.map((row) => this.toCrop(row));
  }

  async assignments(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(zoneSections);
    return Object.fromEntries(rows.map((row) => [row.zoneId, row.crop]));
  }

  /** Moves every zone or none. Returns false if the crop doesn't exist. */
  async move(zoneIds: readonly string[], cropId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [crop] = await tx.select({ id: crops.id }).from(crops).where(eq(crops.id, cropId));
      if (!crop) return false;
      for (const zoneId of zoneIds) {
        await tx
          .insert(zoneSections)
          .values({ zoneId, crop: cropId })
          .onConflictDoUpdate({ target: zoneSections.zoneId, set: { crop: cropId } });
      }
      return true;
    });
  }

  async addCrop(rawName: unknown, rawIcon: unknown): Promise<AddCropOutcome> {
    if (typeof rawName !== "string") return { error: "invalid" };
    const name = rawName.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_CROP_NAME_LENGTH) return { error: "invalid" };
    const icon: CropIconKey = isCropIconKey(rawIcon) ? rawIcon : suggestCropIcon(name);

    try {
      const [row] = await this.db
        .insert(crops)
        .values({ id: crypto.randomUUID(), name, icon })
        .returning();
      return { crop: this.toCrop(row!) };
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "duplicate" };
      throw error;
    }
  }

  /** Returns false if the times are invalid or the crop doesn't exist. */
  async setAlarmTimes(cropId: string, times: unknown, now = new Date()): Promise<boolean> {
    const alarmTimes = normalizeAlarmTimes(times);
    if (!alarmTimes) return false;
    const updated = await this.db
      .update(crops)
      .set({ alarmTimes, scheduleUpdatedAt: now })
      .where(eq(crops.id, cropId))
      .returning({ id: crops.id });
    return updated.length > 0;
  }

  /** Each zone with the alarm times of its section, for the scheduler. */
  async schedule(): Promise<ZoneSchedule[]> {
    const rows = await this.db
      .select({
        zoneId: zoneSections.zoneId,
        alarmTimes: crops.alarmTimes,
        updatedAt: crops.scheduleUpdatedAt,
      })
      .from(zoneSections)
      .innerJoin(crops, eq(zoneSections.crop, crops.id));
    return rows.map(({ zoneId, alarmTimes, updatedAt }) => ({
      zoneId,
      times: alarmTimes ?? this.defaultAlarmTimes,
      updatedAtMs: updatedAt?.getTime() ?? 0,
    }));
  }

  private toCrop({ id, name, icon, alarmTimes }: typeof crops.$inferSelect): Crop {
    return { id, name, icon, alarmTimes: alarmTimes ?? [...this.defaultAlarmTimes] };
  }

  async removeCrop(cropId: string): Promise<RemoveCropOutcome> {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ zoneId: zoneSections.zoneId })
        .from(zoneSections)
        .where(eq(zoneSections.crop, cropId))
        .limit(1);
      if (member) return "not_empty";
      const removed = await tx.delete(crops).where(eq(crops.id, cropId)).returning({ id: crops.id });
      return removed.length > 0 ? "ok" : "not_found";
    });
  }
}
