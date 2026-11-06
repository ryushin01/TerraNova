"use client";

import { Box, Grid, HStack, Text, Wrap } from "@chakra-ui/react";
import { type CropIconKey, SOIL_SUFFICIENT_PCT, type WateringState } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { CropIcon } from "./crops";

const COLUMNS = 8;
const ROWS = 4;
const CELLS = Array.from({ length: COLUMNS * ROWS }, (_, index) => ({
  key: index,
  // Delay by distance from the corner so watering spreads across the field.
  delayMs: ((index % COLUMNS) + Math.floor(index / COLUMNS)) * 90,
}));

export type FieldLook =
  | "dry"
  | "normal"
  | "wet"
  | "alarm"
  | "pending"
  | "watering"
  | "completed"
  | "problem"
  | "offline";

const LEGEND: FieldLook[] = ["dry", "normal", "wet", "alarm", "pending", "watering", "completed", "problem", "offline"];

const SOIL_DRY_BELOW = 40;

const ANIMATIONS: Partial<Record<FieldLook, string>> = {
  watering: "cellWater 1.4s ease-in-out infinite",
  alarm: "cellAlarm 1.2s ease-in-out infinite",
};

interface LookInput {
  state: WateringState | undefined;
  stopped: boolean;
  online: boolean;
  soil: number | undefined;
}

/** A device-reported cycle outranks soil moisture, and being offline hides stale soil colors. */
export function fieldLook({ state, stopped, online, soil }: LookInput): FieldLook {
  if (state === "watering") return "watering";
  if (state === "alarm_sent") return "alarm";
  if (state === "confirmed" || state === "command_sent") return "pending";
  if (state === "failed" || state === "timed_out") return "problem";
  if (!online || soil === undefined) return "offline";
  if (state === "completed" && !stopped) return "completed";
  if (soil < SOIL_DRY_BELOW) return "dry";
  return soil >= SOIL_SUFFICIENT_PCT ? "wet" : "normal";
}

interface FieldPlotProps {
  look: FieldLook;
  label: string;
  icon: CropIconKey | undefined;
}

export const FieldPlot = memo(function FieldPlot({ look, label, icon }: FieldPlotProps) {
  const animation = ANIMATIONS[look];
  return (
    <Grid
      role="img"
      aria-label={label}
      data-look={look}
      data-crop-icon={icon}
      templateColumns={`repeat(${COLUMNS}, 1fr)`}
      gap="1"
    >
      {CELLS.map((cell) => (
        <Box
          key={cell.key}
          data-cell
          aspectRatio={1}
          bg={`field.${look}`}
          transition="background-color 0.3s"
          animation={animation}
          _motionReduce={{ animation: "none" }}
          display="flex"
          alignItems="center"
          justifyContent="center"
          style={animation ? { animationDelay: `${cell.delayMs}ms` } : undefined}
        >
          {icon && <CropIcon icon={icon} boxSize="52%" opacity={0.75} />}
        </Box>
      ))}
    </Grid>
  );
});

export function FieldLegend() {
  const t = useTranslations("dashboard");
  return (
    <Wrap gap="3" aria-label={t("legendTitle")}>
      {LEGEND.map((look) => (
        <HStack key={look} gap="1.5">
          <Box boxSize="3" bg={`field.${look}`} />
          <Text textStyle="xs" color="fg.muted">
            {t(`legend.${look}`)}
          </Text>
        </HStack>
      ))}
    </Wrap>
  );
}
