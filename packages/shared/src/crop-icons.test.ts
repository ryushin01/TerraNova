import { expect, test } from "bun:test";
import { CROP_ICON_KEYS, isCropIconKey, suggestCropIcon } from "./crop-icons";

test.each([
  ["토마토", "tomato"],
  ["방울토마토", "tomato"],
  ["양배추", "cabbage"],
  ["배추", "cabbage"],
  ["배", "pear"],
  ["벼", "wheat"],
  ["찰옥수수", "corn"],
  ["대파", "leek"],
  ["양파", "garlic"],
  ["파프리카", "bellPepper"],
  ["고구마", "potato"],
  ["청양고추", "chili"],
  ["표고버섯", "mushroom"],
  ["도라지", "flower"],
  ["산딸기", "strawberry"],
  ["Cherry Tomato", "tomato"],
  ["  Rice ", "wheat"],
  ["오이", "cucumber"],
  ["오이고추", "chili"],
  ["참외", "melon"],
  ["들깨", "sesame"],
  ["깻잎", "leaf"],
  ["연꽃", "lotus"],
  ["연근", "roots"],
  ["튤립", "tulip"],
  ["선인장", "cactus"],
  ["아몬드", "almond"],
  ["쌈채소", "salad"],
  ["처음보는작물", "sprout"],
  ["", "sprout"],
] as const)("%s gets the %s icon", (name, icon) => {
  expect(suggestCropIcon(name)).toBe(icon);
});

test("only real icon keys are accepted", () => {
  expect(CROP_ICON_KEYS.every(isCropIconKey)).toBe(true);
  expect(isCropIconKey("constructor")).toBe(false);
  expect(isCropIconKey(7)).toBe(false);
});
