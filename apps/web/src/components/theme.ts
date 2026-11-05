import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** A corner cut on the diagonal: the shape running through the whole interface. */
export const chamfer = (size = "24px") =>
  `polygon(0 0, 100% 0, 100% calc(100% - ${size}), calc(100% - ${size}) 100%, 0 100%)`;

export const system = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: { colorPalette: "brand" },
      body: { bg: "canvas", color: "ink" },
    },
    theme: {
      tokens: {
        fonts: {
          heading: { value: "var(--font-pretendard), system-ui, sans-serif" },
          body: { value: "var(--font-pretendard), system-ui, sans-serif" },
        },
      },
      recipes: {
        button: { base: { borderRadius: "full", fontWeight: "bold" } },
      },
      keyframes: {
        cellWater: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        cellAlarm: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      semanticTokens: {
        radii: {
          l1: { value: "3px" },
          l2: { value: "4px" },
          l3: { value: "6px" },
        },
        colors: {
          canvas: { value: "#f7f2f2" },
          ink: { value: "#181818" },
          copper: { value: "#9e653f" },
          brand: {
            contrast: { value: "white" },
            fg: { value: "#181818" },
            subtle: { value: "#efe7e4" },
            muted: { value: "#e4d9d4" },
            emphasized: { value: "#d6c7c0" },
            solid: { value: "#181818" },
            focusRing: { value: "#9e653f" },
          },
          // One place for the field's meaning, used by both the cells and the legend.
          field: {
            dry: { value: "#f3e6bd" },
            normal: { value: "#d5e8cd" },
            wet: { value: "#a8dccf" },
            alarm: { value: "#f7b67e" },
            pending: { value: "#f0d768" },
            watering: { value: "#86bcf4" },
            completed: { value: "#68c47f" },
            problem: { value: "#f09d97" },
            offline: { value: "#e2dedd" },
          },
        },
      },
    },
  }),
);
