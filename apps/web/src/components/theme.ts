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
          // Fallbacks keep the plain, industrial look until the web fonts arrive or if they fail:
          // each OS's Korean gothic, then its UI sans; numbers fall back to a system monospace.
          heading: {
            value:
              'var(--font-roboto), var(--font-nanum-gothic), "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", system-ui, "Segoe UI", sans-serif',
          },
          body: {
            value:
              'var(--font-roboto), var(--font-nanum-gothic), "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", system-ui, "Segoe UI", sans-serif',
          },
          mono: {
            value:
              'var(--font-roboto-mono), var(--font-nanum-gothic-coding), ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "D2Coding", monospace',
          },
        },
      },
      textStyles: {
        // Small survey-map captions on panels and rules.
        caption: {
          value: {
            fontFamily: "mono",
            fontSize: "xs",
            lineHeight: "1.4",
            letterSpacing: "0.06em",
            // Monospace spaces look too wide next to Korean.
            wordSpacing: "-0.25em",
            textTransform: "uppercase",
          },
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
          canvas: { value: { _light: "#f5f5f5", _dark: "#141414" } },
          surface: { value: { _light: "white", _dark: "#212121" } },
          ink: { value: { _light: "#181818", _dark: "#f2f2f2" } },
          inkContrast: { value: { _light: "white", _dark: "#181818" } },
          // The dashboard's overview panels stay dark in either theme.
          night: {
            bg: { value: { _light: "#181818", _dark: "#242424" } },
            fg: { value: "#f2f2f2" },
            muted: { value: "#ababab" },
            line: { value: "rgba(255, 255, 255, 0.16)" },
          },
          chart: {
            grid: { value: { _light: "#e8e8e8", _dark: "#363636" } },
            axis: { value: { _light: "#707070", _dark: "#9e9e9e" } },
          },
          bg: { panel: { value: "{colors.surface}" } },
          brand: {
            contrast: { value: "{colors.inkContrast}" },
            fg: { value: "{colors.ink}" },
            subtle: { value: { _light: "#efefef", _dark: "#2a2a2a" } },
            muted: { value: { _light: "#e4e4e4", _dark: "#363636" } },
            emphasized: { value: { _light: "#d4d4d4", _dark: "#454545" } },
            solid: { value: "{colors.ink}" },
            focusRing: { value: "{colors.ink}" },
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
            offline: { value: { _light: "#e2e2e2", _dark: "#363636" } },
          },
        },
      },
    },
  }),
);
