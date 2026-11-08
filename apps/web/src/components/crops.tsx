import { Box, type BoxProps } from "@chakra-ui/react";
import { CROP_ICON_KEYS, type CropIconKey } from "@terranova/shared";

/**
 * Artwork for each crop icon, drawn in `scripts/crop-art.ts` and kept in public/crops.
 * Crops without a close match share the nearest one. `scripts/crop-icons.ts` regenerates the files.
 */
export const CROP_ICON_FILES: Record<CropIconKey, string> = {
  sprout: "seedling",
  flower: "blossom",
  tulip: "tulip",
  lotus: "lotus",
  rose: "rose",
  sunflower: "sunflower",
  wheat: "sheaf-of-rice",
  corn: "ear-of-corn",
  leaf: "leafy-green",
  salad: "green-salad",
  herb: "herb",
  cabbage: "leafy-green",
  broccoli: "broccoli",
  leek: "onion",
  garlic: "garlic",
  carrot: "carrot",
  beet: "carrot",
  roots: "ginger-root",
  potato: "potato",
  tomato: "tomato",
  chili: "hot-pepper",
  cucumber: "cucumber",
  bellPepper: "bell-pepper",
  eggplant: "eggplant",
  pumpkin: "pumpkin",
  watermelon: "watermelon",
  melon: "melon",
  strawberry: "strawberry",
  berry: "blueberries",
  apple: "red-apple",
  pear: "pear",
  grape: "grapes",
  citrus: "tangerine",
  lemon: "lemon",
  peach: "peach",
  cherry: "cherries",
  banana: "banana",
  pineapple: "pineapple",
  kiwi: "kiwi-fruit",
  avocado: "avocado",
  olive: "olive",
  bean: "beans",
  peas: "pea-pod",
  peanut: "peanuts",
  sesame: "peanuts",
  nut: "chestnut",
  almond: "chestnut",
  acorn: "chestnut",
  mushroom: "mushroom",
  tea: "teacup-without-handle",
  coffee: "hot-beverage",
  bamboo: "shamrock",
  cactus: "cactus",
  cotton: "cherry-blossom",
  hops: "four-leaf-clover",
  grass: "shamrock",
  tree: "deciduous-tree",
};

/** One choice per picture, so the picker doesn't show the same one twice. */
export const CROP_ICON_CHOICES = CROP_ICON_KEYS.filter(
  (key, index) => CROP_ICON_KEYS.findIndex((other) => CROP_ICON_FILES[other] === CROP_ICON_FILES[key]) === index,
);

/** `mono` draws it in the text color, for places where colors already carry a meaning, like the field's cells. */
export function CropIcon({ icon, mono = false, ...props }: { icon: CropIconKey; mono?: boolean } & BoxProps) {
  return (
    <Box asChild flexShrink={0} pointerEvents="none" userSelect="none" {...props}>
      {/* Decorative: the crop's name is always written beside it. */}
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <use href={`/crops/${CROP_ICON_FILES[icon]}.svg#${mono ? "mono" : "icon"}`} />
      </svg>
    </Box>
  );
}
