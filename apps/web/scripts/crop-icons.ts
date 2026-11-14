/**
 * Writes the crop artwork from crop-art.ts into public/crops.
 * The app icon (src/app/icon.svg, public/app-icon.svg and the PNGs) is the brand mark, kept as fixed files.
 * Run: bun scripts/crop-icons.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CROP_ICON_FILES } from "../src/components/crops";
import { type Art, CROP_ART, colorArt, monoArt } from "./crop-art";

const out = join(import.meta.dir, "../public/crops");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const VIEW_BOX = "0 0 64 64";
const art = (name: string): Art => {
  const found = CROP_ART[name];
  if (!found) throw new Error(`No artwork named ${name}`);
  return found;
};

for (const name of new Set(Object.values(CROP_ICON_FILES))) {
  // CropIcon <use>s one of these two, so the one-colour version takes the surrounding text color.
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg"><symbol id="icon" viewBox="${VIEW_BOX}">${colorArt(art(name))}</symbol><symbol id="mono" viewBox="${VIEW_BOX}">${monoArt(art(name))}</symbol></svg>\n`,
  );
}
