import { afterEach, beforeEach, expect, test } from "bun:test";
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

test("a crop with zones cannot be removed; an empty one can", async () => {
  const crop = await addedCrop("토마토");
  await sections.move(["zone-a"], crop.id);
  expect(await sections.removeCrop(crop.id)).toBe("not_empty");
  await sections.move(["zone-a"], "bellflower");
  expect(await sections.removeCrop(crop.id)).toBe("ok");
  expect(await sections.removeCrop(crop.id)).toBe("not_found");
  expect(ZONE_IDS.every((z) => z in DEFAULT_ZONE_CROPS)).toBe(true);
});
