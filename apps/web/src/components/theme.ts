import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** A corner cut on the diagonal: the shape running through the whole interface. */
export const chamfer = (size = "24px") =>
  `polygon(0 0, 100% 0, 100% calc(100% - ${size}), calc(100% - ${size}) 100%, 0 100%)`;

export const system = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: { colorPalette: "brand" },
      // Korean reads badly when a line breaks inside a word.
      body: { bg: "canvas", color: "ink", wordBreak: "keep-all" },
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
          canvas: { value: { _light: "#f7f2f2", _dark: "#141312" } },
          surface: { value: { _light: "white", _dark: "#211f1e" } },
          ink: { value: { _light: "#181818", _dark: "#f3efee" } },
          inkContrast: { value: { _light: "white", _dark: "#181818" } },
          copper: { value: { _light: "#9e653f", _dark: "#d69468" } },
          chart: {
            line: { value: "#b85a1f" },
            grid: { value: { _light: "#ece6e4", _dark: "#37332f" } },
            axis: { value: { _light: "#8a8381", _dark: "#9c9591" } },
          },
          bg: { panel: { value: "{colors.surface}" } },
          brand: {
            contrast: { value: "{colors.inkContrast}" },
            fg: { value: "{colors.ink}" },
            subtle: { value: { _light: "#efe7e4", _dark: "#2c2927" } },
            muted: { value: { _light: "#e4d9d4", _dark: "#37332f" } },
            emphasized: { value: { _light: "#d6c7c0", _dark: "#46413c" } },
            solid: { value: "{colors.ink}" },
            focusRing: { value: "{colors.copper}" },
          },
          // One place for the field's meaning, used by both the cells and the legend.
          field: {
            dry: { value: { _light: "#f3e6bd", _dark: "#5c5026" } },
            normal: { value: { _light: "#d5e8cd", _dark: "#2f4a33" } },
            wet: { value: { _light: "#a8dccf", _dark: "#1f5a50" } },
            alarm: { value: { _light: "#f7b67e", _dark: "#8a4f1d" } },
            pending: { value: { _light: "#f0d768", _dark: "#7a6a17" } },
            watering: { value: { _light: "#86bcf4", _dark: "#22558f" } },
            completed: { value: { _light: "#68c47f", _dark: "#23783f" } },
            problem: { value: { _light: "#f09d97", _dark: "#8a322c" } },
            offline: { value: { _light: "#e2dedd", _dark: "#37332f" } },
          },
        },
      },
    },
  }),
);
