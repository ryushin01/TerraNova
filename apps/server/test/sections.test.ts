import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ZONE_CROPS, ZONE_IDS } from "@terranova/shared";
import { openDatabase } from "../src/db";
import { ZoneSections } from "../src/sections";

let database: Awaited<ReturnType<typeof openDatabase>>;
let sections: ZoneSections;

beforeEach(async () => {
  database = await openDatabase();
  sections = new ZoneSections(database.db);
  await sections.init();
});

afterEach(() => database.close());

test("a database can be created where no folder exists yet", async () => {
  const root = mkdtempSync(join(tmpdir(), "terranova-db-"));
  const nested = await openDatabase(join(root, "not/yet/there/pglite"));
  await nested.close();
  rmSync(root, { recursive: true, force: true });
});

const addedCrop = async (name: string, icon?: string) => {
  const outcome = await sections.addCrop(name, icon);
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome.crop;
};

test("a new install has the built-in sections and every zone placed", async () => {
  expect((await sections.crops()).map((c) => c.id)).toEqual(["bellflower", "rice", "lettuce"]);
  expect(await sections.assignments()).toEqual(DEFAULT_ZONE_CROPS);
});

test("init never undoes a zone that was moved", async () => {
  await sections.move(["zone-a"], "rice");
  await sections.init();
  expect((await sections.assignments())["zone-a"]).toBe("rice");
});

describe("alarm times", () => {
  const withDefaults = () => new ZoneSections(database.db, ["08:00", "18:00"]);
  const scheduleOf = async (s: ZoneSections, zone: string) => (await s.schedule()).find((z) => z.zoneId === zone);

  test("sections follow the default times until changed", async () => {
    const s = withDefaults();
    expect((await s.crops())[0]?.alarmTimes).toEqual(["08:00", "18:00"]);
    expect(await scheduleOf(s, "zone-a")).toEqual({ zoneId: "zone-a", times: ["08:00", "18:00"], updatedAtMs: 0 });
  });

  test("saved times are sorted, de-duplicated and apply only to that section's zones", async () => {
    const s = withDefaults();
    const now = new Date("2026-11-05T00:00:00Z");
    expect(await s.setAlarmTimes("rice", ["18:30", "06:00", "18:30"], now)).toBe(true);
    expect(await scheduleOf(s, "zone-c")).toEqual({
      zoneId: "zone-c",
      times: ["06:00", "18:30"],
      updatedAtMs: now.getTime(),
    });
    expect((await scheduleOf(s, "zone-a"))?.times).toEqual(["08:00", "18:00"]);
  });

  test("an empty list means no alarms, not the default", async () => {
    const s = withDefaults();
    await s.setAlarmTimes("rice", []);
    expect((await scheduleOf(s, "zone-c"))?.times).toEqual([]);
    expect((await s.crops()).find((c) => c.id === "rice")?.alarmTimes).toEqual([]);
  });

  test("a moved zone follows its new section", async () => {
    const s = withDefaults();
    await s.setAlarmTimes("rice", ["05:00"]);
    await s.move(["zone-a"], "rice");
    expect((await scheduleOf(s, "zone-a"))?.times).toEqual(["05:00"]);
  });

  test.each([
    [["24:00"]],
    [["8:00"]],
    [["08:60"]],
    [["08:00:00"]],
    [[""]],
    [[7]],
    ["08:00"],
    [null],
    [Array.from({ length: 13 }, (_, i) => `0${i % 10}:${10 + i}`)],
  ])("rejects %j and keeps the old times", async (times) => {
    const s = withDefaults();
    await s.setAlarmTimes("rice", ["05:00"]);
    expect(await s.setAlarmTimes("rice", times)).toBe(false);
    expect((await scheduleOf(s, "zone-c"))?.times).toEqual(["05:00"]);
  });

  test("an unknown crop is refused", async () => {
    expect(await withDefaults().setAlarmTimes("nope", ["05:00"])).toBe(false);
  });
});

test("a new crop gets an icon from its name, or the one chosen", async () => {
  expect((await addedCrop("토마토")).icon).toBe("tomato");
  expect((await addedCrop("이름모를작물")).icon).toBe("sprout");
  expect((await addedCrop("방울이", "cherry")).icon).toBe("cherry");
  expect((await addedCrop("수상한값", "<script>")).icon).toBe("sprout");
  expect((await sections.crops()).map((c) => c.name)).toContain("수상한값");
});

test.each([[""], ["   "], ["가".repeat(31)], [null], [7]])("rejects the crop name %p", async (name) => {
  expect(await sections.addCrop(name, undefined)).toEqual({ error: "invalid" });
});

test("names are unique, ignoring case and extra spaces", async () => {
  await addedCrop("Cherry Tomato");
  expect(await sections.addCrop("cherry  tomato", undefined)).toEqual({ error: "duplicate" });
  expect(await sections.addCrop("도라지", undefined)).toEqual({ error: "duplicate" });
});

test("moves several zones at once, and refuses an unknown crop without changing anything", async () => {
  const crop = await addedCrop("토마토");
  expect(await sections.move(["zone-a", "zone-c", "zone-e"], crop.id)).toBe(true);
  const moved = await sections.assignments();
  expect(["zone-a", "zone-c", "zone-e"].map((z) => moved[z])).toEqual([crop.id, crop.id, crop.id]);
  expect(moved["zone-b"]).toBe("bellflower");

  expect(await sections.move(["zone-b", "zone-d"], "nope")).toBe(false);
  expect((await sections.assignments())["zone-b"]).toBe("bellflower");
});

test("a move is all or nothing", async () => {
  const before = await sections.assignments();
  await expect(sections.move(["zone-a", null as never], "rice")).rejects.toThrow();
  expect(await sections.assignments()).toEqual(before);
});

describe("editing crops", () => {
  test("renaming and changing the icon keep the zones and alarm times", async () => {
    const s = new ZoneSections(database.db, ["08:00"]);
    await s.setAlarmTimes("rice", ["05:00"]);
    const outcome = await s.updateCrop("rice", "  찹쌀 벼 ", "corn");
    expect(outcome).toMatchObject({
      previousName: "벼",
      crop: { id: "rice", name: "찹쌀 벼", icon: "corn", alarmTimes: ["05:00"] },
    });
    expect((await s.assignments())["zone-c"]).toBe("rice");
  });

  test("a name already in use is refused; keeping your own name is fine", async () => {
    expect(await sections.updateCrop("rice", "도라지", "wheat")).toEqual({ error: "duplicate" });
    expect(await sections.updateCrop("rice", "벼", "corn")).toMatchObject({ crop: { icon: "corn" } });
  });

  test.each([
    ["rice", "", "wheat"],
    ["rice", "가".repeat(31), "wheat"],
    ["rice", "새이름", "not-an-icon"],
    ["nope", "새이름", "wheat"],
  ])("refuses %s, %s, %s", async (id, name, icon) => {
    expect(await sections.updateCrop(id, name, icon)).toEqual({ error: "invalid" });
    expect((await sections.crops()).find((c) => c.id === "rice")?.name).toBe("벼");
  });
});

describe("section order", () => {
  const order = async () => (await sections.crops()).map((c) => c.id);

  test("new crops go last and the order can be changed", async () => {
    const crop = await addedCrop("토마토");
    expect(await order()).toEqual(["bellflower", "rice", "lettuce", crop.id]);
    expect(await sections.reorder([crop.id, "lettuce", "rice", "bellflower"])).toBe(true);
    expect(await order()).toEqual([crop.id, "lettuce", "rice", "bellflower"]);
    const second = await addedCrop("감자");
    expect((await order()).at(-1)).toBe(second.id);
  });

  test.each([
    [["rice", "bellflower"]],
    [["rice", "rice", "bellflower"]],
    [["rice", "bellflower", "nope"]],
    [["rice", "bellflower", "lettuce", "nope"]],
    ["rice"],
    [[1, 2, 3]],
    [null],
  ])("refuses %j and keeps the order", async (ids) => {
    expect(await sections.reorder(ids)).toBe(false);
    expect(await order()).toEqual(["bellflower", "rice", "lettuce"]);
  });
});

test("a crop with zones cannot be removed; an empty one can", async () => {
  const crop = await addedCrop("토마토");
  await sections.move(["zone-a"], crop.id);
  expect(await sections.removeCrop(crop.id)).toBe("not_empty");
  await sections.move(["zone-a"], "bellflower");
  expect(await sections.removeCrop(crop.id)).toBe("ok");
  expect(await sections.removeCrop(crop.id)).toBe("not_found");
  expect(ZONE_IDS.every((z) => z in DEFAULT_ZONE_CROPS)).toBe(true);
});
