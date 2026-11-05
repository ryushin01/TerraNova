import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

export const system = createSystem(
  defaultConfig,
  defineConfig({
    theme: {
      keyframes: {
        cellWater: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        cellAlarm: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
      },
      semanticTokens: {
        colors: {
          // One place for the field's meaning, used by both the cells and the legend.
          field: {
            dry: { value: "{colors.yellow.300}" },
            normal: { value: "{colors.green.300}" },
            wet: { value: "{colors.teal.500}" },
            alarm: { value: "{colors.orange.500}" },
            pending: { value: "{colors.yellow.500}" },
            watering: { value: "{colors.blue.500}" },
            completed: { value: "{colors.green.600}" },
            problem: { value: "{colors.red.500}" },
            offline: { value: "{colors.gray.300}" },
          },
        },
      },
    },
  }),
);
