import {
  DEFAULT_ZONE_CROPS,
  ZONE_IDS,
  isCropIconKey,
  suggestCropIcon,
  type Crop,
  type CropIconKey,
} from "@terranova/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "./db";
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
  constructor(private readonly db: Database) {}

  /** Gives every zone a section. Zones already placed are left where they are. */
  async init(): Promise<void> {
    await this.db
      .insert(zoneSections)
      .values(ZONE_IDS.map((zoneId) => ({ zoneId, crop: DEFAULT_ZONE_CROPS[zoneId] })))
      .onConflictDoNothing();
  }

  async crops(): Promise<Crop[]> {
    const rows = await this.db.select().from(crops).orderBy(asc(crops.createdAt), asc(crops.id));
    return rows.map(({ id, name, icon }) => ({ id, name, icon }));
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
      return { crop: { id: row!.id, name: row!.name, icon: row!.icon } };
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "duplicate" };
      throw error;
    }
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
