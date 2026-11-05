import { expect, test } from "bun:test";
import { CROP_ICON_KEYS } from "@terranova/shared";
import en from "../messages/en.json";
import ko from "../messages/ko.json";

type Messages = { [key: string]: string | Messages };

/** Every message as a dotted key, e.g. "nav.signOut". */
function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [inner, text] of flatten(value, path)) flat.set(inner, text);
  }
  return flat;
}

/** The arguments a message expects: {name} and the first word of {count, plural, ...}. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((match) => match[1]))].sort();

const flatKo = flatten(ko);
const flatEn = flatten(en);

test("both languages have the same messages", () => {
  expect([...flatEn.keys()].sort()).toEqual([...flatKo.keys()].sort());
});

test("no message is blank", () => {
  for (const flat of [flatKo, flatEn]) {
    for (const [key, text] of flat) expect(`${key}: ${text.trim() ? "ok" : "blank"}`).toBe(`${key}: ok`);
  }
});

test("a message takes the same arguments in both languages", () => {
  for (const [key, text] of flatKo) {
    expect(`${key}: ${placeholders(flatEn.get(key) ?? "")}`).toBe(`${key}: ${placeholders(text)}`);
  }
});

test("every crop icon has a name in both languages", () => {
  for (const icon of CROP_ICON_KEYS) {
    expect(flatKo.has(`cropIcons.${icon}`)).toBe(true);
    expect(flatEn.has(`cropIcons.${icon}`)).toBe(true);
  }
});

test("the placeholder check sees real arguments", () => {
  expect(placeholders("{zone} {count, plural, other {# fields}}")).toEqual(["count", "zone"]);
});
