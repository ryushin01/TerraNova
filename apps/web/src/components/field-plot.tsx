"use client";

import { Box, Grid } from "@chakra-ui/react";
import {
  type CropIconKey,
  SOIL_SUFFICIENT_PCT,
  type WateringCycle,
  type WateringState,
  type ZoneSnapshot,
} from "@terranova/shared";
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

export const LEGEND: FieldLook[] = [
  "dry",
  "normal",
  "wet",
  "alarm",
  "pending",
  "watering",
  "completed",
  "problem",
  "offline",
];

export const SOIL_DRY_BELOW = 40;

export const FIELD_ANIMATIONS: Partial<Record<FieldLook, string>> = {
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
function fieldLook({ state, stopped, online, soil }: LookInput): FieldLook {
  if (state === "watering") return "watering";
  if (state === "alarm_sent") return "alarm";
  if (state === "confirmed" || state === "command_sent") return "pending";
  if (state === "failed" || state === "timed_out") return "problem";
  if (!online || soil === undefined) return "offline";
  if (state === "completed" && !stopped) return "completed";
  if (soil < SOIL_DRY_BELOW) return "dry";
  return soil >= SOIL_SUFFICIENT_PCT ? "wet" : "normal";
}

/** What a zone's device and watering cycle add up to, shared by its card and the overview map. */
export function zoneCondition(zone: ZoneSnapshot | undefined, cycle: WateringCycle | undefined, disconnected: boolean) {
  const online = !disconnected && !!zone?.online;
  const stopped = cycle?.state === "completed" && cycle.reason === "stopped_by_command";
  const look = fieldLook({ state: cycle?.state, stopped, online, soil: zone?.telemetry?.soilMoisturePct });
  return { online, stopped, look, stateKey: stopped ? "stopped" : (cycle?.state ?? "idle") };
}

interface FieldPlotProps {
  look: FieldLook;
  label: string;
  icon: CropIconKey | undefined;
}

export const FieldPlot = memo(function FieldPlot({ look, label, icon }: FieldPlotProps) {
  const animation = FIELD_ANIMATIONS[look];
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
          {icon && <CropIcon icon={icon} mono boxSize="60%" />}
        </Box>
      ))}
    </Grid>
  );
});
