/** Writes the crop artwork used by the app into public/crops. Run: bun scripts/crop-icons.ts */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import icons from "@iconify-json/fluent-emoji-flat/icons.json";
import { CROP_ICON_FILES } from "../src/components/crops";

const out = join(import.meta.dir, "../public/crops");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const set = icons as { icons: Record<string, { body: string }>; width?: number; height?: number };
const size = set.width ?? 32;
for (const name of new Set(Object.values(CROP_ICON_FILES))) {
  const icon = set.icons[name];
  if (!icon) throw new Error(`No artwork named ${name}`);
  const viewBox = `0 0 ${size} ${set.height ?? size}`;
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${icon.body}</svg>\n`,
  );
}
