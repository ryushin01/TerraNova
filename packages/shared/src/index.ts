import type { CropIconKey } from "./crop-icons";

export * from "./crop-icons";

/** Contract between devices (or the simulator) and the backend over MQTT. */

export const ZONE_IDS = ["zone-a", "zone-b", "zone-c", "zone-d", "zone-e", "zone-f"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const ACTUATORS = ["pump", "vent", "light"] as const;
export type Actuator = (typeof ACTUATORS)[number];

/** Devices must stop the pump after this long, even if the backend is unreachable. */
export const MAX_PUMP_DURATION_SEC = 300;

export const DEFAULT_MQTT_PORT = 1883;

/** At or above this soil moisture, watering is skipped to avoid overwatering. */
export const SOIL_SUFFICIENT_PCT = 70;

export const topics = {
  telemetry: (zoneId: string) => `terranova/zones/${zoneId}/telemetry`,
  status: (zoneId: string) => `terranova/zones/${zoneId}/status`,
  command: (zoneId: string, actuator: Actuator) =>
    `terranova/zones/${zoneId}/actuators/${actuator}/command`,
  ack: (zoneId: string, actuator: Actuator) =>
    `terranova/zones/${zoneId}/actuators/${actuator}/ack`,
  allTelemetry: "terranova/zones/+/telemetry",
  allStatuses: "terranova/zones/+/status",
  allAcks: "terranova/zones/+/actuators/+/ack",
} as const;

export interface Telemetry {
  zoneId: string;
  timestamp: string;
  temperatureC: number;
  humidityPct: number;
  soilMoisturePct: number;
  actuators: Record<Actuator, boolean>;
}

export interface ZoneStatus {
  zoneId: string;
  online: boolean;
}

export interface Command {
  /** Retrying with the same id must never run the command twice. */
  commandId: string;
  action: "on" | "off";
  /** Pump only. Missing or longer values are limited to MAX_PUMP_DURATION_SEC. */
  durationSec?: number;
}

export type AckStatus = "accepted" | "completed" | "rejected" | "failed";

export interface CommandAck {
  commandId: string;
  zoneId: string;
  actuator: Actuator;
  status: AckStatus;
  reason?: string;
  timestamp: string;
}

export function parseCommand(payload: string): Command | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const { commandId, action, durationSec } = value as Record<string, unknown>;
  if (typeof commandId !== "string" || commandId.length === 0) return null;
  if (action !== "on" && action !== "off") return null;
  if (durationSec === undefined) return { commandId, action };
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  return { commandId, action, durationSec };
}

function parseObject(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseTelemetry(payload: string): Telemetry | null {
  const v = parseObject(payload);
  if (!v) return null;
  const actuators = v.actuators as Record<string, unknown> | undefined;
  const valid =
    typeof v.zoneId === "string" &&
    typeof v.timestamp === "string" &&
    Number.isFinite(v.temperatureC) &&
    Number.isFinite(v.humidityPct) &&
    Number.isFinite(v.soilMoisturePct) &&
    typeof actuators === "object" &&
    actuators !== null &&
    ACTUATORS.every((a) => typeof actuators[a] === "boolean");
  return valid ? (v as unknown as Telemetry) : null;
}

export function parseZoneStatus(payload: string): ZoneStatus | null {
  const v = parseObject(payload);
  return v && typeof v.zoneId === "string" && typeof v.online === "boolean"
    ? (v as unknown as ZoneStatus)
    : null;
}

export function parseAck(payload: string): CommandAck | null {
  const v = parseObject(payload);
  const valid =
    v &&
    typeof v.commandId === "string" &&
    typeof v.zoneId === "string" &&
    isActuator(v.actuator as string) &&
    ["accepted", "completed", "rejected", "failed"].includes(v.status as string);
  return valid ? (v as unknown as CommandAck) : null;
}

export function isZoneId(value: string | undefined): value is ZoneId {
  return (ZONE_IDS as readonly string[]).includes(value ?? "");
}

export function isActuator(value: string | undefined): value is Actuator {
  return (ACTUATORS as readonly string[]).includes(value ?? "");
}

export const DEFAULT_SOCKET_PORT = 4000;

/** idle in the UI means a zone has no cycle yet or its latest cycle has ended. */
export const WATERING_TRANSITIONS = {
  alarm_sent: ["confirmed", "timed_out"],
  confirmed: ["command_sent", "skipped", "failed"],
  command_sent: ["watering", "completed", "failed"],
  watering: ["completed", "failed"],
  completed: [],
  failed: [],
  timed_out: [],
  skipped: [],
} as const;

export type WateringState = keyof typeof WATERING_TRANSITIONS;

export const ACTIVE_WATERING_STATES = ["alarm_sent", "confirmed", "command_sent", "watering"] as const;

export function canTransition(from: WateringState, to: WateringState): boolean {
  return (WATERING_TRANSITIONS[from] as readonly WateringState[]).includes(to);
}

export interface WateringCycle {
  id: string;
  zoneId: string;
  state: WateringState;
  durationSec: number;
  reason: string | null;
  reminderCount: number;
  alarmSentAt: string | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ZoneSnapshot {
  zoneId: string;
  online: boolean;
  lastSeenAt: string | null;
  telemetry: Telemetry | null;
}

/** A section is a group of zones growing the same crop, so moving a zone changes its crop. */
export interface Crop {
  id: string;
  name: string;
  icon: CropIconKey;
  /** Daily local alarm times as HH:mm, sorted. Empty means no scheduled alarms. */
  alarmTimes: string[];
}

export const MAX_ALARM_TIMES = 12;

const ALARM_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sorted and without duplicates, or null if anything isn't a valid time or there are too many. */
export function normalizeAlarmTimes(times: unknown): string[] | null {
  if (!Array.isArray(times)) return null;
  if (!times.every((time) => typeof time === "string" && ALARM_TIME_PATTERN.test(time))) return null;
  const unique = [...new Set(times as string[])].sort();
  return unique.length <= MAX_ALARM_TIMES ? unique : null;
}

export const DEFAULT_ZONE_CROPS: Record<ZoneId, string> = {
  "zone-a": "bellflower",
  "zone-b": "bellflower",
  "zone-c": "rice",
  "zone-d": "rice",
  "zone-e": "lettuce",
  "zone-f": "lettuce",
};

export type AddCropResult =
  | { ok: true; crop: Crop }
  | { ok: false; error: "invalid" | "duplicate" | "forbidden" | "internal" };

export type RemoveCropResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_empty" | "forbidden" | "internal" };

export interface FarmSnapshot {
  crops: Crop[];
  /** The time zone alarm times are in. */
  timeZone: string;
  sections: Record<string, string>;
  zones: ZoneSnapshot[];
  /** Latest cycle per zone. Sent on every connect, so alarms missed while away still appear. */
  cycles: WateringCycle[];
}

export type ConfirmResult =
  | { ok: true; cycle: WateringCycle }
  | { ok: false; error: "not_found" | "already_handled" | "forbidden" | "internal" };

/** Actuators people may switch directly. The pump only starts through a confirmed alarm. */
export const MANUAL_ACTUATORS = ["vent", "light"] as const;
export type ManualActuator = (typeof MANUAL_ACTUATORS)[number];

export function isManualActuator(value: unknown): value is ManualActuator {
  return (MANUAL_ACTUATORS as readonly unknown[]).includes(value);
}

export type ControlError = "invalid" | "forbidden" | "zone_offline" | "no_ack" | "device_failed" | "internal";
export type ControlResult = { ok: true } | { ok: false; error: ControlError };

export const ROLE_NAMES = ["admin", "operator", "viewer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Viewers can watch the farm. Only these roles may operate devices. */
export function canControl(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

export interface ServerToClientEvents {
  snapshot: (snapshot: FarmSnapshot) => void;
  "zone:update": (zone: ZoneSnapshot) => void;
  "cycle:update": (cycle: WateringCycle) => void;
  "crops:update": (crops: Crop[]) => void;
  "sections:update": (sections: Record<string, string>) => void;
}

export interface ClientToServerEvents {
  "alarm:confirm": (cycleId: string, callback: (result: ConfirmResult) => void) => void;
  "watering:start": (zoneId: string, callback: (result: ConfirmResult) => void) => void;
  "zones:move": (zoneIds: string[], cropId: string, callback: (result: ControlResult) => void) => void;
  "crop:add": (name: string, icon: CropIconKey, callback: (result: AddCropResult) => void) => void;
  "crop:schedule": (cropId: string, times: string[], callback: (result: ControlResult) => void) => void;
  "crop:remove": (cropId: string, callback: (result: RemoveCropResult) => void) => void;
  "pump:stop": (zoneId: string, callback: (result: ControlResult) => void) => void;
  "actuator:set": (
    zoneId: string,
    actuator: ManualActuator,
    on: boolean,
    callback: (result: ControlResult) => void,
  ) => void;
}
