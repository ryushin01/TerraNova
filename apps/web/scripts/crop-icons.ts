/**
 * Writes the one-color crop artwork into public/crops, and the install icon built from the seedling.
 * Run: bun scripts/crop-icons.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import icons from "@iconify-json/fluent-emoji-high-contrast/icons.json";
import { CROP_ICON_FILES } from "../src/components/crops";

const out = join(import.meta.dir, "../public/crops");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const set = icons as { icons: Record<string, { body: string }>; width?: number; height?: number };
const size = set.width ?? 32;
const viewBox = `0 0 ${size} ${set.height ?? size}`;

/** Drawn here to match the set, whose only pumpkin has a jack-o'-lantern's face. */
const OWN_ARTWORK: Record<string, string> = {
  pumpkin:
    '<path fill="currentColor" d="M14.5 8.5V5.8c0-2 1.5-3.8 3.7-3.8H20v2.6h-1.6c-.8 0-1.3.6-1.3 1.4v2.5z"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M16 8.7C13.8 7 11.2 6.6 8.8 7.6 4.6 9.2 2 13.3 2 18s2.6 8.2 6.8 9.6c2.5.8 5.1.4 7.2-1 2.1 1.4 4.7 1.8 7.2 1 4.2-1.4 6.8-4.9 6.8-9.6s-2.6-8.8-6.8-10.4c-2.4-1-5-.6-7.2 1.1z"/>' +
    '<path d="M11.2 7.4C9.2 10.2 8.2 13.8 8.2 18s1 7.4 2.8 9.2"/>' +
    '<path d="M20.8 7.4c2 2.8 3 6.4 3 10.6s-1 7.4-2.8 9.2"/></g>',
};

/** Some artwork is clipped to its own viewBox, which the viewBox already does. */
const artwork = (name: string) => {
  if (OWN_ARTWORK[name]) return OWN_ARTWORK[name];
  const icon = set.icons[name];
  if (!icon) throw new Error(`No artwork named ${name}`);
  return icon.body.replace(/ clip-path="url\(#[^"]*\)"/g, "").replace(/<defs>.*?<\/defs>/g, "");
};

for (const name of new Set(Object.values(CROP_ICON_FILES))) {
  // The id lets CropIcon <use> the artwork, so it takes the surrounding text color.
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" id="icon">${artwork(name)}</svg>\n`,
  );
}

// A launcher can put a transparent icon on any color, so this one brings its own background.
writeFileSync(
  join(import.meta.dir, "../public/app-icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><rect width="${size}" height="${size}" fill="#fff"/><g color="#181818" transform="translate(5 5) scale(.6875)">${artwork("seedling")}</g></svg>\n`,
);
