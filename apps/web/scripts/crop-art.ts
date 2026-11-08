/**
 * The crop artwork: flat shapes on a 64-unit grid, each in one of five tones. Every picture is
 * written twice, in colour and in one colour, where the tones become levels of opacity.
 */
export type Tone = "a" | "b" | "c" | "d" | "e";
export interface Shape {
  tone: Tone;
  element: string;
  stroke?: boolean;
}
export type Palette = Record<Tone, string>;
export interface Art {
  palette: Palette;
  shapes: Shape[];
}

const n = (value: number) => String(Math.round(value * 100) / 100);
const turn = (rot: number, x: number, y: number) => (rot ? ` transform="rotate(${n(rot)} ${n(x)} ${n(y)})"` : "");

const P = (tone: Tone, d: string, transform = ""): Shape => ({
  tone,
  element: `<path d="${d}"${transform ? ` transform="${transform}"` : ""}`,
});
const C = (tone: Tone, x: number, y: number, r: number): Shape => ({
  tone,
  element: `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"`,
});
const E = (tone: Tone, x: number, y: number, rx: number, ry: number, rot = 0): Shape => ({
  tone,
  element: `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${turn(rot, x, y)}`,
});
const R = (tone: Tone, x: number, y: number, w: number, h: number, r = 0, rot = 0): Shape => ({
  tone,
  element: `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"${turn(rot, x + w / 2, y + h / 2)}`,
});
const S = (tone: Tone, d: string, width = 2): Shape => ({
  tone,
  stroke: true,
  element: `<path d="${d}" fill="none" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"`,
});

/** A leaf or petal from its base, split down the middle into two tones. */
const leaf = (light: Tone, dark: Tone, x: number, y: number, len: number, wid: number, angle: number): Shape[] => {
  const t = `translate(${n(x)} ${n(y)}) rotate(${n(angle)})`;
  const curve = (w: number) => `C${n(w)} ${n(-len * 0.3)} ${n(w * 0.85)} ${n(-len * 0.8)} 0 ${n(-len)}`;
  return [P(light, `M0 0${curve(-wid)}Z`, t), P(dark, `M0 0${curve(wid)}Z`, t)];
};
const ring = (count: number, start = 0) => Array.from({ length: count }, (_, i) => start + (360 / count) * i);
const stem = (tone: Tone, x: number, top: number, bottom: number, w = 4) =>
  R(tone, x - w / 2, top, w, bottom - top, w / 2);

const Y = "#FFCF5C";
const Y2 = "#F5AE45";
const T = "#4AD9C1";
const T2 = "#2FBFA6";
const RD = "#F4645A";
const RD2 = "#D8463F";
const O = "#FA9F42";
const O2 = "#E67F24";
const PU = "#9A78E4";
const PU2 = "#7755C8";
const PK = "#F88FAA";
const PK2 = "#E66A8B";
const BR = "#BE8A5C";
const BR2 = "#96663C";
const G = "#9ADB72";
const G2 = "#74BE4F";
const CR = "#F7E8CB";
const CR2 = "#E6CFA2";
const BL = "#6D8DEB";
const BL2 = "#4E6DD0";
const TAN = "#E5BE80";
const TAN2 = "#CC9C58";
const INK = "#5A4038";

const pal = (a: string, b: string, c = T, d = T2, e = BR2): Palette => ({ a, b, c, d, e });

const heart = (light: Tone, dark: Tone, x: number, y: number, size: number, angle: number): Shape[] => {
  const t = `translate(${n(x)} ${n(y)}) rotate(${n(angle)}) scale(${n(size / 20)})`;
  return [P(light, "M0 0C-3-5-8-8-12-16-14-22-5-25 0-18Z", t), P(dark, "M0 0C3-5 8-8 12-16 14-22 5-25 0-18Z", t)];
};

const kidney = (tone: Tone, shade: Tone, x: number, y: number, rot: number): Shape[] => {
  const t = `translate(${n(x)} ${n(y)}) rotate(${n(rot)})`;
  return [
    P(tone, "M-15-3C-14-12-3-13 3-10 9-13 16-9 16-1 16 8 8 13 0 12-9 12-16 6-15-3Z", t),
    P(shade, "M16-1C16 8 8 13 0 12-5 12-10 10-13 6-6 9 8 9 16-1Z", t),
  ];
};

export const CROP_ART: Record<string, Art> = {
  seedling: {
    palette: pal(BR, BR2),
    shapes: [
      stem("d", 32, 26, 54),
      ...leaf("c", "d", 32, 36, 30, 13, -55),
      ...leaf("c", "d", 32, 30, 26, 11, 48),
      P("a", "M10 60Q32 42 54 60Z"),
      P("b", "M32 49.5Q44 51 54 60H32Z"),
    ],
  },
  blossom: {
    palette: pal(PK, PK2, Y, Y2),
    shapes: [...ring(5).flatMap((a) => leaf("a", "b", 32, 33, 29, 15, a)), C("c", 32, 33, 8), C("d", 32, 33, 4)],
  },
  tulip: {
    palette: pal(PK, PK2),
    shapes: [
      stem("d", 32, 38, 60),
      ...leaf("c", "d", 32, 60, 30, 8, -32),
      ...leaf("c", "d", 32, 60, 30, 8, 32),
      P("a", "M16 8L24 17 32 5 40 17 48 8V28Q48 43 32 43 16 43 16 28Z"),
      P("b", "M32 5L40 17 48 8V28Q48 43 32 43Z"),
    ],
  },
  lotus: {
    palette: pal(PK, PK2),
    shapes: [
      E("c", 32, 54, 26, 6),
      E("d", 32, 56, 18, 3),
      ...leaf("a", "b", 32, 50, 34, 11, -68),
      ...leaf("a", "b", 32, 50, 34, 11, 68),
      ...leaf("a", "b", 32, 50, 40, 12, -34),
      ...leaf("a", "b", 32, 50, 40, 12, 34),
      ...leaf("a", "b", 32, 50, 44, 13, 0),
    ],
  },
  rose: {
    palette: pal(RD, RD2),
    shapes: [
      stem("d", 32, 38, 62),
      ...leaf("c", "d", 32, 54, 18, 8, -62),
      ...leaf("c", "d", 32, 48, 18, 8, 62),
      C("a", 32, 23, 21),
      C("b", 33, 23, 14.5),
      C("a", 31, 22, 9.5),
      C("b", 32, 23, 4),
    ],
  },
  sunflower: {
    palette: pal(Y, Y2, BR, BR2, INK),
    shapes: [
      ...ring(12).flatMap((a) => leaf(a % 60 === 0 ? "a" : "b", a % 60 === 0 ? "b" : "a", 32, 32, 30, 8, a)),
      C("c", 32, 32, 13),
      C("d", 32, 32, 8),
      C("e", 32, 32, 3),
    ],
  },
  "sheaf-of-rice": {
    palette: pal(Y, Y2, TAN, TAN2),
    shapes: [
      stem("d", 32, 22, 62, 3),
      ...[14, 24, 34, 44].flatMap((y) => [E("a", 22.5, y, 5, 9, -32), E("b", 41.5, y, 5, 9, 32)]),
      E("a", 32, 8, 5, 8),
      P("b", "M32 0A5 8 0 0 1 32 16Z"),
    ],
  },
  "ear-of-corn": {
    palette: pal(Y, Y2),
    shapes: [
      E("a", 32, 25, 15, 24),
      ...[8, 14, 20, 26, 32, 38].flatMap((y, row) => {
        const half = Math.sqrt(1 - ((y - 25) / 24) ** 2) * 15 - 3;
        const start = row % 2 ? 4 : 0;
        return [-16, -8, 0, 8, 16]
          .map((x) => x + start - 2)
          .filter((x) => Math.abs(x) <= half - 1)
          .map((x) => R("b", 30 + x, y, 4, 3.4, 1.7));
      }),
      ...leaf("c", "d", 31, 63, 44, 15, -24),
      ...leaf("d", "c", 33, 63, 44, 15, 24),
    ],
  },
  "leafy-green": {
    palette: pal(G, G2, T, T2, "#D9F2BE"),
    shapes: [
      C("a", 18, 32, 12),
      C("a", 25, 18, 13),
      C("b", 39, 18, 13),
      C("b", 46, 32, 12),
      C("a", 32, 34, 16),
      P("b", "M32 18A16 16 0 0 1 32 50Z"),
      C("b", 44, 40, 9),
      C("a", 20, 42, 9),
      P("e", "M30 60L31 18H33L34 60Z"),
      S("e", "M32 32L22 24M32 40L43 31", 2),
    ],
  },
  "green-salad": {
    palette: pal(CR, CR2, G, G2, RD),
    shapes: [
      C("c", 18, 24, 11),
      C("d", 32, 19, 12),
      C("c", 46, 25, 10),
      C("e", 26, 25, 7),
      C("d", 41, 30, 7),
      P("a", "M6 32H58Q58 58 32 60 6 58 6 32Z"),
      P("b", "M32 32H58Q58 58 32 60Z"),
    ],
  },
  herb: {
    palette: pal(T, T2),
    shapes: [
      stem("d", 32, 20, 62, 3),
      ...leaf("a", "b", 32, 56, 24, 9, -68),
      ...leaf("a", "b", 32, 56, 24, 9, 68),
      ...leaf("a", "b", 32, 42, 24, 9, -62),
      ...leaf("a", "b", 32, 42, 24, 9, 62),
      ...leaf("a", "b", 32, 30, 28, 11, 0),
    ],
  },
  broccoli: {
    palette: pal(G, G2),
    shapes: [
      P("a", "M24 34H40L37 60Q32 62 27 60Z"),
      P("b", "M32 34H40L37 60Q34.5 61 32 61Z"),
      C("c", 16, 28, 11),
      C("d", 48, 28, 11),
      C("c", 25, 16, 12),
      C("d", 40, 16, 12),
      C("c", 32, 29, 13),
      P("d", "M32 16A13 13 0 0 1 32 42Z"),
    ],
  },
  onion: {
    palette: pal(PK, PK2, T, T2, "#FBC7D4"),
    shapes: [
      ...leaf("c", "d", 32, 24, 22, 6, -14),
      ...leaf("c", "d", 32, 24, 22, 6, 14),
      P("a", "M32 16C36 26 54 30 54 44 54 56 42 60 32 60 22 60 10 56 10 44 10 30 28 26 32 16Z"),
      P("b", "M32 16C36 26 54 30 54 44 54 56 42 60 32 60Z"),
      S("e", "M32 26V54M24 32Q18 44 24 56M40 32Q46 44 40 56", 1.8),
    ],
  },
  garlic: {
    palette: pal(CR, CR2, "#D9B8E8", "#BE97D4", TAN2),
    shapes: [
      P("c", "M29 18Q32 6 30 3H34Q32 6 35 18Z"),
      E("a", 21, 42, 13, 18, -8),
      E("b", 43, 42, 13, 18, 8),
      P("a", "M32 12C37 24 42 32 42 44 42 54 37 60 32 60 27 60 22 54 22 44 22 32 27 24 32 12Z"),
      P("b", "M32 12C37 24 42 32 42 44 42 54 37 60 32 60Z"),
      S("e", "M26 62H38", 2.4),
    ],
  },
  carrot: {
    palette: pal(O, O2),
    shapes: [
      ...leaf("c", "d", 32, 24, 22, 7, -32),
      ...leaf("c", "d", 32, 24, 22, 7, 32),
      ...leaf("c", "d", 32, 24, 24, 7, 0),
      P("a", "M19 26Q32 18 45 26 44 44 34 61 32 63 30 61 20 44 19 26Z"),
      P("b", "M32 21Q40 21 45 26 44 44 34 61 33 62 32 62Z"),
      R("b", 22, 33, 9, 2.4, 1.2),
      R("a", 34, 41, 7, 2.4, 1.2),
      R("b", 26, 49, 6, 2.4, 1.2),
    ],
  },
  "ginger-root": {
    palette: pal(TAN, TAN2),
    shapes: [
      E("a", 17, 21, 9, 12, -24),
      E("b", 45, 18, 8, 11, 24),
      E("b", 52, 44, 9, 8, 10),
      E("a", 12, 45, 8, 7, -10),
      E("a", 31, 36, 21, 15, -8),
      P("b", "M31 21C45 20 52 27 52 34 52 44 42 51 31 51Z"),
      S("b", "M16 37H24M36 28L40 34", 2),
    ],
  },
  potato: {
    palette: pal(TAN, TAN2),
    shapes: [
      E("a", 32, 33, 27, 21, -14),
      P("b", "M56 24C60 36 52 50 37 53 26 55 14 52 9 44 26 50 48 42 56 24Z"),
      E("b", 22, 26, 3, 2),
      E("b", 37, 21, 3, 2),
      E("b", 42, 35, 3, 2),
      E("b", 26, 40, 3, 2),
    ],
  },
  tomato: {
    palette: pal(RD, RD2),
    shapes: [
      E("a", 32, 37, 27, 24),
      P("b", "M32 13A27 24 0 0 1 32 61Z"),
      ...leaf("c", "d", 32, 18, 14, 5, -105),
      ...leaf("c", "d", 32, 18, 14, 5, 105),
      ...leaf("c", "d", 32, 18, 14, 5, -150),
      ...leaf("c", "d", 32, 18, 14, 5, 150),
      R("d", 30, 6, 4, 13, 2),
    ],
  },
  "hot-pepper": {
    palette: pal(RD, RD2),
    shapes: [
      P("a", "M36 18C52 18 58 32 50 46 42 56 22 63 6 58 22 54 30 42 28 28 28 22 31 18 36 18Z"),
      P("b", "M50 46C42 56 22 63 6 58 26 58 42 50 52 30 54 36 53 41 50 46Z"),
      P("c", "M27 25C30 15 42 13 49 22 42 21 33 22 27 25Z"),
      S("d", "M38 17Q39 9 46 5", 4),
    ],
  },
  cucumber: {
    palette: pal(G, G2, "#D9F2BE", T2),
    shapes: [
      R("a", 3, 21, 58, 22, 11, -45),
      P("b", "M47.5 8.5A11 11 0 0 1 55.3 27.3L27.3 55.3A11 11 0 0 1 8.5 47.5Z"),
      R("c", 24, 22, 10, 2.6, 1.3, -45),
      R("c", 34, 30, 10, 2.6, 1.3, -45),
      R("c", 20, 37, 10, 2.6, 1.3, -45),
    ],
  },
  "bell-pepper": {
    palette: pal(Y, Y2),
    shapes: [
      S("d", "M32 16Q32 8 38 5", 5),
      E("a", 20, 38, 15, 22),
      E("b", 44, 38, 15, 22),
      E("a", 32, 39, 11, 22),
      P("b", "M32 17A11 22 0 0 1 32 61Z"),
      P("c", "M16 19Q32 8 48 19 40 22 32 19 24 22 16 19Z"),
    ],
  },
  eggplant: {
    palette: pal(PU, PU2),
    shapes: [
      P("a", "M41 16C55 22 59 38 50 50 40 62 18 64 9 54 3 46 8 36 17 31 24 27 32 18 41 16Z"),
      P("b", "M41 16C55 22 59 38 50 50 40 62 18 64 9 54 20 58 42 50 47 18 45 17 43 16 41 16Z"),
      P("c", "M30 24C34 14 44 9 54 14 56 22 52 30 46 32 45 26 38 22 30 24Z"),
      S("d", "M50 13Q54 8 60 6", 4.5),
    ],
  },
  pumpkin: {
    palette: pal(O, O2),
    shapes: [
      S("d", "M32 18Q32 8 40 5", 5),
      E("b", 12, 38, 10, 18),
      E("b", 52, 38, 10, 18),
      E("a", 21, 38, 12, 21),
      E("a", 43, 38, 12, 21),
      E("b", 32, 38, 10, 22),
    ],
  },
  watermelon: {
    palette: pal(RD, RD2, T2, CR, INK),
    shapes: [
      P("c", "M3 20H61A29 31 0 0 1 3 20Z"),
      P("d", "M7 20H57A25 27 0 0 1 7 20Z"),
      P("a", "M10 20H54A22 24 0 0 1 10 20Z"),
      P("b", "M32 20H54A22 24 0 0 1 32 44Z"),
      E("e", 22, 27, 1.8, 3),
      E("e", 32, 33, 1.8, 3),
      E("e", 42, 27, 1.8, 3),
    ],
  },
  melon: {
    palette: pal("#D6E48C", "#BACB64", T, T2, "#F4F8D2"),
    shapes: [
      S("d", "M32 8Q32 4 37 2", 4),
      C("a", 32, 35, 27),
      P("b", "M32 8A27 27 0 0 1 32 62Z"),
      S("e", "M32 8V62M18 12Q6 35 18 58M46 12Q58 35 46 58M6 28Q32 20 58 28M6 44Q32 52 58 44", 1.6),
    ],
  },
  strawberry: {
    palette: pal(RD, RD2, T, T2, CR),
    shapes: [
      P("a", "M32 62C16 54 5 38 8 25 10 16 22 14 32 17 42 14 54 16 56 25 59 38 48 54 32 62Z"),
      P("b", "M32 17C42 14 54 16 56 25 59 38 48 54 32 62Z"),
      ...[
        [20, 28],
        [32, 30],
        [44, 28],
        [15, 38],
        [26, 40],
        [38, 40],
        [49, 38],
        [24, 50],
        [32, 53],
        [40, 50],
      ].map(([x, y]) => E("e", x!, y!, 1.5, 2.4)),
      ...leaf("c", "d", 32, 19, 15, 6, -78),
      ...leaf("c", "d", 32, 19, 15, 6, 78),
      ...leaf("c", "d", 32, 19, 15, 6, 0),
    ],
  },
  blueberries: {
    palette: pal(BL, BL2, "#3F5AB6", T2),
    shapes: [
      C("a", 20, 41, 16),
      P("b", "M20 25A16 16 0 0 1 20 57Z"),
      C("a", 45, 44, 13),
      P("b", "M45 31A13 13 0 0 1 45 57Z"),
      C("a", 35, 20, 15),
      P("b", "M35 5A15 15 0 0 1 35 35Z"),
      ...[
        [35, 15],
        [20, 37],
        [45, 41],
      ].map(([x, y]) => P("c", "M0-4.5L1.6-1.6 4.5 0 1.6 1.6 0 4.5-1.6 1.6-4.5 0-1.6-1.6Z", `translate(${x} ${y})`)),
    ],
  },
  "red-apple": {
    palette: pal(RD, RD2),
    shapes: [
      P(
        "a",
        "M32 22C24 15 7 16 6 36 5 50 16 62 25 62 28 62 30 60 32 60 34 60 36 62 39 62 48 62 59 50 58 36 57 16 40 15 32 22Z",
      ),
      P("b", "M32 22C40 15 57 16 58 36 59 50 48 62 39 62 36 62 34 60 32 60Z"),
      S("e", "M32 22Q31 12 35 7", 3.4),
      ...leaf("c", "d", 34, 15, 19, 7, 62),
    ],
  },
  pear: {
    palette: pal("#D9DF6F", "#BFC54A"),
    shapes: [
      P(
        "a",
        "M32 12C40 12 41 22 44 30 47 38 54 42 54 50 54 60 42 63 32 63 22 63 10 60 10 50 10 42 17 38 20 30 23 22 24 12 32 12Z",
      ),
      P("b", "M32 12C40 12 41 22 44 30 47 38 54 42 54 50 54 60 42 63 32 63Z"),
      S("e", "M32 13Q32 7 35 3", 3.4),
      ...leaf("c", "d", 34, 11, 16, 6, 68),
    ],
  },
  grapes: {
    palette: pal(PU, PU2),
    shapes: [
      S("e", "M32 12Q32 6 37 3", 3.4),
      ...leaf("c", "d", 32, 12, 18, 7, 72),
      ...[
        [16, 22, "a"],
        [32, 20, "b"],
        [48, 22, "a"],
        [24, 33, "b"],
        [40, 33, "a"],
        [15, 40, "a"],
        [49, 40, "b"],
        [32, 44, "a"],
        [23, 52, "b"],
        [41, 52, "a"],
        [32, 60, "b"],
      ].map(([x, y, t]) => C(t as Tone, x as number, (y as number) - (y === 60 ? 2 : 0), 8)),
    ],
  },
  tangerine: {
    palette: pal(O, O2),
    shapes: [
      E("a", 32, 37, 27, 24),
      P("b", "M32 13A27 24 0 0 1 32 61Z"),
      ...leaf("c", "d", 32, 15, 20, 8, 58),
      C("d", 32, 15, 3),
    ],
  },
  lemon: {
    palette: pal(Y, Y2),
    shapes: [
      P(
        "a",
        "M8 56C3 50 6 44 10 40 10 24 24 12 40 10 44 6 50 3 56 8 61 14 58 20 54 24 52 40 40 54 24 54 20 58 14 61 8 56Z",
      ),
      P("b", "M56 8C61 14 58 20 54 24 52 40 40 54 24 54 20 58 14 61 8 56 28 52 50 34 56 8Z"),
      ...leaf("c", "d", 46, 12, 18, 7, -60),
    ],
  },
  peach: {
    palette: pal(PK, PK2),
    shapes: [
      P("a", "M32 16C20 8 5 18 5 36 5 52 18 62 32 62 46 62 59 52 59 36 59 18 44 8 32 16Z"),
      P("b", "M32 16C44 8 59 18 59 36 59 52 46 62 32 62Q42 40 32 16Z"),
      ...leaf("c", "d", 32, 15, 22, 8, 56),
    ],
  },
  cherries: {
    palette: pal(RD, RD2, T, T2, G2),
    shapes: [
      S("e", "M16 40Q24 18 40 6M46 42Q48 22 40 6", 3),
      ...leaf("c", "d", 40, 7, 20, 7, -70),
      C("a", 16, 46, 14),
      P("b", "M16 32A14 14 0 0 1 16 60Z"),
      C("a", 46, 47, 14),
      P("b", "M46 33A14 14 0 0 1 46 61Z"),
    ],
  },
  banana: {
    palette: pal(Y, Y2, BR2, BR, BR2),
    shapes: [
      P("a", "M12 12C12 36 30 58 56 54 61 53 61 46 56 45 40 43 26 30 22 10 21 5 12 6 12 12Z"),
      P("b", "M12 12C12 36 30 58 56 54 60 53 61 49 59 47 36 52 16 34 12 12Z"),
      P("c", "M13 12L12 4H20L22 10Z"),
      P("c", "M55 45L61 46V53L55 54Z"),
    ],
  },
  pineapple: {
    palette: pal(Y, Y2),
    shapes: [
      ...leaf("c", "d", 32, 24, 20, 6, -42),
      ...leaf("c", "d", 32, 24, 20, 6, 42),
      ...leaf("c", "d", 32, 24, 24, 7, 0),
      E("a", 32, 43, 19, 20),
      P("b", "M32 23A19 20 0 0 1 32 63Z"),
      S("b", "M17 33L37 62M26 25L50 56M47 33L27 62M38 25L14 56", 1.6),
    ],
  },
  "kiwi-fruit": {
    palette: pal(BR, BR2, G, "#F2F6CF", INK),
    shapes: [
      C("a", 32, 32, 29),
      C("c", 32, 32, 25),
      C("d", 32, 32, 9),
      ...ring(12).map((a) => {
        const r = (a * Math.PI) / 180;
        return E("e", 32 + Math.sin(r) * 15, 32 - Math.cos(r) * 15, 1.4, 2.6, a);
      }),
    ],
  },
  avocado: {
    palette: pal(G, "#E2EFA0", G2, BR2, BR),
    shapes: [
      P(
        "c",
        "M32 3C42 3 44 14 48 24 52 32 58 38 58 46 58 56 46 62 32 62 18 62 6 56 6 46 6 38 12 32 16 24 20 14 22 3 32 3Z",
      ),
      P(
        "b",
        "M32 9C39 9 40 18 44 27 48 34 52 40 52 46 52 53 42 57 32 57 22 57 12 53 12 46 12 40 16 34 20 27 24 18 25 9 32 9Z",
      ),
      C("d", 32, 42, 11.5),
      P("e", "M32 30.5A11.5 11.5 0 0 1 32 53.5Z"),
    ],
  },
  olive: {
    palette: pal("#A9B55A", "#87943C"),
    shapes: [
      S("d", "M6 12Q30 12 58 34", 3),
      ...leaf("c", "d", 18, 12, 18, 6, 30),
      ...leaf("c", "d", 40, 21, 18, 6, 15),
      ...leaf("c", "d", 30, 16, 16, 5, 170),
      S("d", "M22 13V24M43 25V34", 2),
      E("a", 21, 38, 11, 15, 8),
      P("b", "M23 23.3C29 25 33 31 32 39 31 47 26 53 20 53Z"),
      E("a", 44, 46, 10, 13, -8),
      P("b", "M42 33C48 33 54 39 54 46 54 53 49 59 45 59Z"),
    ],
  },
  beans: {
    palette: pal("#D0704F", "#AE5236"),
    shapes: [...kidney("a", "b", 21, 22, -18), ...kidney("a", "b", 45, 29, 22), ...kidney("a", "b", 27, 48, 6)],
  },
  "pea-pod": {
    palette: pal(T, T2, G, G2),
    shapes: [
      S("b", "M56 10Q60 6 61 2", 3.4),
      P("a", "M7 54C6 32 30 8 56 9 60 9 61 13 60 17 56 40 34 60 11 58 8 58 7 56 7 54Z"),
      ...[
        [17, 45],
        [27, 34],
        [38, 26],
        [49, 18],
      ].map(([x, y]) => C("c", x!, y!, 7.5)),
      ...[
        [19, 47],
        [29, 36],
        [40, 28],
        [51, 20],
      ].map(([x, y]) => C("d", x!, y!, 3.5)),
    ],
  },
  peanuts: {
    palette: pal(TAN, TAN2),
    shapes: (() => {
      const t = "rotate(40 32 32)";
      return [
        P(
          "a",
          "M32 4C44 4 49 13 47 23 46 28 43 30 43 33 43 36 47 39 48 45 49 55 43 60 32 60 21 60 15 55 16 45 17 39 21 36 21 33 21 30 18 28 17 23 15 13 20 4 32 4Z",
          t,
        ),
        P("b", "M32 4C44 4 49 13 47 23 46 28 43 30 43 33 43 36 47 39 48 45 49 55 43 60 32 60Z", t),
        P("b", "M22 13h7v2.2h-7zM21 21h8v2.2h-8zM21 42h8v2.2h-8zM22 50h7v2.2h-7z", t),
        P("a", "M36 13h7v2.2h-7zM36 21h8v2.2h-8zM36 42h8v2.2h-8zM36 50h7v2.2h-7z", t),
      ];
    })(),
  },
  chestnut: {
    palette: pal(BR, BR2, CR, CR2, BR2),
    shapes: [
      P("a", "M32 4C34 12 58 20 58 40 58 48 56 52 54 54H10C8 52 6 48 6 40 6 20 30 12 32 4Z"),
      P("b", "M32 4C34 12 58 20 58 40 58 48 56 52 54 54H32Z"),
      P("c", "M8 47Q32 40 56 47 57 58 44 61 32 63 20 61 7 58 8 47Z"),
      P("d", "M32 43.5Q45 44 56 47 57 58 44 61 38 62 32 62Z"),
    ],
  },
  mushroom: {
    palette: pal(RD, RD2, CR, CR2, "#FFF6E8"),
    shapes: [
      P("c", "M24 34H40L44 58Q32 64 20 58Z"),
      P("d", "M32 34H40L44 58Q38 61 32 61Z"),
      P("a", "M4 36C4 16 18 4 32 4 46 4 60 16 60 36 60 40 56 41 52 40 40 37 24 37 12 40 8 41 4 40 4 36Z"),
      P("b", "M32 4C46 4 60 16 60 36 60 40 56 41 52 40 46 38 39 37 32 37Z"),
      C("e", 20, 22, 6),
      C("e", 38, 14, 4.5),
      C("e", 45, 28, 5),
    ],
  },
  "teacup-without-handle": {
    palette: pal(CR, CR2, G, G2, "#CDBB98"),
    shapes: [
      S("e", "M25 16Q21 11 25 7Q28 3 25 0M39 16Q35 11 39 7Q42 3 39 0", 2.6),
      P("a", "M8 22H56C56 44 48 58 42 60H22C16 58 8 44 8 22Z"),
      P("b", "M32 22H56C56 44 48 58 42 60H32Z"),
      E("c", 32, 22, 24, 5),
      P("d", "M32 17A24 5 0 0 1 32 27Z"),
    ],
  },
  "hot-beverage": {
    palette: pal(CR, CR2, BR, BR2, "#CDBB98"),
    shapes: [
      S("e", "M20 15Q16 10 20 6Q23 2 20 0M34 15Q30 10 34 6Q37 2 34 0", 2.6),
      S("b", "M46 30H52Q60 30 60 38 60 48 50 48H44", 5),
      P("a", "M6 20H48V50Q48 62 36 62H18Q6 62 6 50Z"),
      P("b", "M27 20H48V50Q48 62 36 62H27Z"),
      E("c", 27, 20, 21, 5),
      P("d", "M27 15A21 5 0 0 1 27 25Z"),
    ],
  },
  shamrock: {
    palette: pal(T, T2, T2, T2),
    shapes: [
      S("b", "M32 32Q33 50 40 62", 4),
      ...heart("a", "b", 32, 33, 25, 0),
      ...heart("a", "b", 32, 33, 25, -118),
      ...heart("a", "b", 32, 33, 25, 118),
    ],
  },
  "four-leaf-clover": {
    palette: pal(G, G2, T2, T2),
    shapes: [
      S("c", "M32 32Q40 46 50 58", 4),
      ...heart("a", "b", 32, 32, 24, 0),
      ...heart("a", "b", 32, 32, 24, 90),
      ...heart("a", "b", 32, 32, 24, 180),
      ...heart("a", "b", 32, 32, 24, 270),
    ],
  },
  cactus: {
    palette: pal(T, T2, O, O2),
    shapes: [
      S("a", "M14 22V32Q14 38 22 38H30", 8),
      S("b", "M50 16V26Q50 32 42 32H34", 8),
      R("a", 23, 4, 18, 46, 9),
      P("b", "M32 4A9 9 0 0 1 41 13V50H32Z"),
      P("c", "M16 46H48L44 62H20Z"),
      P("d", "M32 46H48L44 62H32Z"),
    ],
  },
  "cherry-blossom": {
    palette: pal("#FBC2D1", PK, PK2, Y2),
    shapes: [
      ...ring(5).flatMap((a) => {
        const t = `translate(32 34) rotate(${a})`;
        return [P("a", "M0 0C-13-7-15-22-8-28L0-23Z", t), P("b", "M0 0C13-7 15-22 8-28L0-23Z", t)];
      }),
      C("c", 32, 34, 5.5),
      ...ring(5, 36).map((a) => {
        const r = (a * Math.PI) / 180;
        return C("d", 32 + Math.sin(r) * 11, 34 - Math.cos(r) * 11, 1.7);
      }),
    ],
  },
  "deciduous-tree": {
    palette: pal(BR, BR2),
    shapes: [
      P("a", "M28 36H36L38 62H26Z"),
      P("b", "M32 36H36L38 62H32Z"),
      C("c", 18, 30, 14),
      C("c", 26, 16, 14),
      C("d", 42, 18, 13),
      C("d", 47, 32, 13),
      C("c", 32, 30, 15),
      P("d", "M32 15A15 15 0 0 1 32 45Z"),
    ],
  },
};

/** How strongly each tone shows in the one-colour version. */
const MONO_OPACITY: Record<Tone, number> = { a: 0.32, b: 0.58, c: 0.45, d: 0.7, e: 0.85 };

const paint = (shape: Shape, color: string, opacity?: number) =>
  `${shape.element} ${shape.stroke ? "stroke" : "fill"}="${color}"${opacity === undefined ? "" : ` opacity="${opacity}"`}/>`;

export const colorArt = ({ palette, shapes }: Art) => shapes.map((shape) => paint(shape, palette[shape.tone])).join("");
export const monoArt = ({ shapes }: Art) =>
  shapes.map((shape) => paint(shape, "currentColor", MONO_OPACITY[shape.tone])).join("");
