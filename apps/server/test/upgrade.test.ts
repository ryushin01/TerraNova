import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createAuth } from "../src/auth";
import { openDatabase } from "../src/db";
import { ControlHistory } from "../src/history";
import { ZoneSections } from "../src/sections";
import { type WateringConfig, WateringService } from "../src/watering";
import { ZoneRegistry } from "../src/zones";

const migrations = join(import.meta.dir, "../drizzle");
const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
const versions: string[] = journal.entries.map((entry: { tag: string }) => entry.tag);

const roots: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "terranova-upgrade-"));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database as an older release left it: only the first `count` migrations applied. */
async function databaseAtVersion(dataDir: string, count: number, seed?: (client: PGlite) => Promise<void>) {
  const folder = join(tempDir(), "migrations");
  cpSync(migrations, folder, { recursive: true });
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
  );
  const client = new PGlite(dataDir);
  await migrate(drizzle(client), { migrationsFolder: folder });
  await seed?.(client);
  await client.close();
}

const WATERING: WateringConfig = {
  timeZone: "Asia/Seoul",
  durationSec: 30,
  soilSufficientPct: 70,
  remindAfterMs: 60_000,
  alarmTimeoutMs: 120_000,
  ackTimeoutMs: 15_000,
  completionGraceMs: 15_000,
};

const cycleRow = (zone: string, state: string) =>
  `INSERT INTO watering_cycles (zone_id, slot, state, duration_sec, created_at)
   VALUES ('${zone}', 'slot-${zone}', '${state}', 30, now())`;

describe("upgrading a database", () => {
  test.each(versions.slice(0, -1).map((tag, index) => [tag, index + 1] as const))(
    "from %s reaches the latest version",
    async (_tag, count) => {
      const dataDir = join(tempDir(), "db");
      await databaseAtVersion(dataDir, count);
      const database = await openDatabase(dataDir);
      const sections = new ZoneSections(database.db, ["08:00"]);
      await sections.init();
      expect((await sections.crops()).map((crop) => crop.id)).toEqual(["bellflower", "rice", "lettuce"]);
      await database.close();
    },
  );

  test("keeps accounts, watering records and moved zones from the first release", async () => {
    const dataDir = join(tempDir(), "db");
    // The first two migrations: before crops existed as their own table.
    await databaseAtVersion(dataDir, 2, async (client) => {
      await client.exec(`
        INSERT INTO "user" (id, name, email, role) VALUES ('u1', '김작업', 'kim@terranova.test', 'operator');
        INSERT INTO zone_sections (zone_id, crop) VALUES ('zone-a', 'rice');
        ${cycleRow("zone-b", "completed")};
        ${cycleRow("zone-c", "alarm_sent")};
      `);
    });

    const database = await openDatabase(dataDir);
    const sections = new ZoneSections(database.db, ["08:00"]);
    await sections.init();

    // Moved zones stay where they were; the rest get their default section.
    const assigned = await sections.assignments();
    expect(assigned["zone-a"]).toBe("rice");
    expect(assigned["zone-b"]).toBe("bellflower");

    const watering = new WateringService({
      db: database.db,
      zones: new ZoneRegistry(15_000),
      config: WATERING,
      schedule: async () => [],
      publish: async () => {},
      onCycleChange: () => {},
    });
    const cycles = await watering.latestCycles();
    expect(cycles.map((cycle) => [cycle.zoneId, cycle.state])).toEqual([
      ["zone-b", "completed"],
      ["zone-c", "alarm_sent"],
    ]);

    const auth = createAuth({
      db: database.db,
      baseURL: "http://localhost:3000",
      secret: "s".repeat(40),
      trustedOrigins: [],
    });
    const context = await auth.$context;
    expect((await context.internalAdapter.findUserByEmail("kim@terranova.test"))?.user.name).toBe("김작업");
    await database.close();
  });

  test("added crops keep their order and gain working alarm times and automation", async () => {
    const dataDir = join(tempDir(), "db");
    // Up to just before sections had a stored position.
    const beforePosition = versions.findIndex((tag) => tag.startsWith("0005"));
    await databaseAtVersion(dataDir, beforePosition, async (client) => {
      await client.exec(`
        INSERT INTO crops (id, name, icon, created_at) VALUES ('tomato', '토마토', 'tomato', now() + interval '1 hour');
        INSERT INTO crops (id, name, icon, created_at) VALUES ('corn', '옥수수', 'corn', now() + interval '2 hours');
        INSERT INTO zone_sections (zone_id, crop) VALUES ('zone-f', 'tomato');
      `);
    });

    const database = await openDatabase(dataDir);
    const sections = new ZoneSections(database.db, ["08:00"]);
    await sections.init();
    const crops = await sections.crops();
    expect(crops.map((crop) => crop.id)).toEqual(["bellflower", "rice", "lettuce", "tomato", "corn"]);
    expect(crops.at(-1)?.alarmTimes).toEqual(["08:00"]);
    expect(crops.at(-1)?.automation.ventOnAboveC).toBeNull();
    expect((await sections.assignments())["zone-f"]).toBe("tomato");

    // A crop added after the upgrade goes last.
    const added = await sections.addCrop("감자", "potato");
    expect("crop" in added && (await sections.crops()).at(-1)?.id === added.crop.id).toBe(true);

    expect(await sections.setAutomation("tomato", { ventOnAboveC: 30, ventOffBelowC: 25 })).toBe(true);
    expect((await new ControlHistory(database.db).list({ limit: 1 })).entries).toEqual([]);
    await database.close();
  });

  test("automation saved before humidity rules existed still works", async () => {
    const database = await openDatabase(join(tempDir(), "db"));
    const sections = new ZoneSections(database.db);
    await sections.init();
    await database.db.execute(
      sql`UPDATE crops SET automation = '{"ventOnAboveC":30,"ventOffBelowC":25,"lightOnAt":null,"lightOffAt":null,"soilAlarmBelowPct":null}'::jsonb WHERE id = 'rice'`,
    );
    const rice = (await sections.crops()).find((crop) => crop.id === "rice");
    expect(rice?.automation.ventOnAboveC).toBe(30);
    expect(rice?.automation.ventOnAboveHumidityPct).toBeNull();
    await database.close();
  });

  test("opening an up-to-date database again changes nothing", async () => {
    const dataDir = join(tempDir(), "db");
    const first = await openDatabase(dataDir);
    const sections = new ZoneSections(first.db);
    await sections.init();
    await sections.move(["zone-a"], "rice");
    await first.close();

    const second = await openDatabase(dataDir);
    expect((await new ZoneSections(second.db).assignments())["zone-a"]).toBe("rice");
    await second.close();
  });
});
