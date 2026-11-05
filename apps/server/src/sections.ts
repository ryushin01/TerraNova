import {
  DEFAULT_ZONE_CROPS,
  ZONE_IDS,
  NO_AUTOMATION,
  isCropIconKey,
  normalizeAlarmTimes,
  normalizeAutomation,
  suggestCropIcon,
  type Crop,
  type CropIconKey,
} from "@terranova/shared";
import { asc, eq, max } from "drizzle-orm";
import type { Database } from "./db";
import type { ZoneRules } from "./automation";
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

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_CROP_NAME_LENGTH ? name : null;
}

export type AddCropOutcome = { crop: Crop } | { error: "invalid" | "duplicate" };
export type UpdateCropOutcome = { crop: Crop; previousName: string } | { error: "invalid" | "duplicate" };
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
    const rows = await this.db.select().from(crops).orderBy(asc(crops.position), asc(crops.id));
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
    const name = cleanName(rawName);
    if (!name) return { error: "invalid" };
    const icon: CropIconKey = isCropIconKey(rawIcon) ? rawIcon : suggestCropIcon(name);

    try {
      const [last] = await this.db.select({ position: max(crops.position) }).from(crops);
      const [row] = await this.db
        .insert(crops)
        .values({ id: crypto.randomUUID(), name, icon, position: (last?.position ?? 0) + 1 })
        .returning();
      return { crop: this.toCrop(row!) };
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "duplicate" };
      throw error;
    }
  }

  /** Renames a crop or changes its icon. Its zones and alarm times stay as they are. */
  async updateCrop(cropId: string, rawName: unknown, rawIcon: unknown): Promise<UpdateCropOutcome> {
    const name = cleanName(rawName);
    if (!name || !isCropIconKey(rawIcon)) return { error: "invalid" };
    try {
      const [previous] = await this.db.select({ name: crops.name }).from(crops).where(eq(crops.id, cropId));
      if (!previous) return { error: "invalid" };
      const [row] = await this.db.update(crops).set({ name, icon: rawIcon }).where(eq(crops.id, cropId)).returning();
      return { crop: this.toCrop(row!), previousName: previous.name };
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "duplicate" };
      throw error;
    }
  }

  /** Takes the full new order. Anything else is refused, so no section can drop out of the list. */
  async reorder(cropIds: unknown): Promise<boolean> {
    if (!Array.isArray(cropIds) || !cropIds.every((id) => typeof id === "string")) return false;
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: crops.id }).from(crops);
      const known = new Set(existing.map(({ id }) => id));
      if (cropIds.length !== known.size || new Set(cropIds).size !== known.size) return false;
      if (!cropIds.every((id) => known.has(id))) return false;
      for (const [position, id] of cropIds.entries()) {
        await tx.update(crops).set({ position }).where(eq(crops.id, id));
      }
      return true;
    });
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

  /** Returns false if the rules are invalid or the crop doesn't exist. */
  async setAutomation(cropId: string, rules: unknown): Promise<boolean> {
    const automation = normalizeAutomation(rules);
    if (!automation) return false;
    const updated = await this.db.update(crops).set({ automation }).where(eq(crops.id, cropId)).returning({ id: crops.id });
    return updated.length > 0;
  }

  async automationRules(): Promise<ZoneRules[]> {
    return this.db
      .select({ zoneId: zoneSections.zoneId, rules: crops.automation })
      .from(zoneSections)
      .innerJoin(crops, eq(zoneSections.crop, crops.id));
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

  private toCrop({ id, name, icon, alarmTimes, automation }: typeof crops.$inferSelect): Crop {
    return {
      id,
      name,
      icon,
      alarmTimes: alarmTimes ?? [...this.defaultAlarmTimes],
      automation: automation ?? NO_AUTOMATION,
    };
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
