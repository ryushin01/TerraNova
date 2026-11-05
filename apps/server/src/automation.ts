import type { AutomationRules, ControlResult, ManualActuator, Telemetry } from "@terranova/shared";

const COOLDOWN_MS = 60_000;
const MANUAL_PAUSE_MS = 30 * 60_000;
/** A dry zone alarms at most once in this period, however long it stays dry. */
const SOIL_ALARM_EVERY_MS = 6 * 60 * 60_000;

export interface ZoneRules {
  zoneId: string;
  rules: AutomationRules | null;
}

export interface AutomationDeps {
  schedule: () => Promise<ZoneRules[]>;
  /** The zone's current reading, or null when it is offline. */
  liveReading: (zoneId: string, nowMs: number) => Telemetry | null;
  setActuator: (zoneId: string, actuator: ManualActuator, on: boolean) => Promise<ControlResult>;
  /** Raises an alarm, at most once per slot. Someone still has to confirm before any watering. */
  raiseAlarm: (zoneId: string, slot: string) => Promise<unknown>;
  onSwitched: (zoneId: string, actuator: ManualActuator, on: boolean, result: ControlResult) => void;
  localMinutes: (nowMs: number) => number;
}

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
};

/** What a rule wants the vent to be, or null to leave it alone between the two temperatures. */
export function desiredVent(rules: AutomationRules, temperatureC: number): boolean | null {
  if (rules.ventOnAboveC === null || rules.ventOffBelowC === null) return null;
  if (temperatureC >= rules.ventOnAboveC) return true;
  if (temperatureC <= rules.ventOffBelowC) return false;
  return null;
}

/** Whether the lights should be on now. The window may run past midnight. */
export function desiredLight(rules: AutomationRules, minutes: number): boolean | null {
  if (rules.lightOnAt === null || rules.lightOffAt === null) return null;
  const on = toMinutes(rules.lightOnAt);
  const off = toMinutes(rules.lightOffAt);
  return on <= off ? minutes >= on && minutes < off : minutes >= on || minutes < off;
}

/**
 * Follows each section's rules for ventilation and lighting, and raises alarms for dry soil.
 * It has no way to start a pump: watering always needs a person.
 */
export class Automation {
  private readonly nextAttemptMs = new Map<string, number>();
  private readonly pausedUntilMs = new Map<string, number>();

  constructor(private readonly deps: AutomationDeps) {}

  /** Someone chose this setting by hand, so rules leave it alone for a while. */
  noteManualChange(zoneId: string, actuator: ManualActuator, nowMs: number): void {
    this.pausedUntilMs.set(`${zoneId}|${actuator}`, nowMs + MANUAL_PAUSE_MS);
  }

  async tick(nowMs: number): Promise<void> {
    const minutes = this.deps.localMinutes(nowMs);
    for (const { zoneId, rules } of await this.deps.schedule()) {
      if (!rules) continue;
      const reading = this.deps.liveReading(zoneId, nowMs);
      if (!reading) continue;

      await this.apply(zoneId, "vent", desiredVent(rules, reading.temperatureC), reading, nowMs);
      await this.apply(zoneId, "light", desiredLight(rules, minutes), reading, nowMs);

      if (rules.soilAlarmBelowPct !== null && reading.soilMoisturePct < rules.soilAlarmBelowPct) {
        await this.deps.raiseAlarm(zoneId, `soil-${Math.floor(nowMs / SOIL_ALARM_EVERY_MS)}`);
      }
    }
  }

  private async apply(
    zoneId: string,
    actuator: ManualActuator,
    desired: boolean | null,
    reading: Telemetry,
    nowMs: number,
  ): Promise<void> {
    if (desired === null || reading.actuators[actuator] === desired) return;
    const key = `${zoneId}|${actuator}`;
    if ((this.pausedUntilMs.get(key) ?? 0) > nowMs) return;
    // Waits between attempts, so a device that isn't responding isn't sent a command every tick.
    if ((this.nextAttemptMs.get(key) ?? 0) > nowMs) return;
    this.nextAttemptMs.set(key, nowMs + COOLDOWN_MS);
    this.deps.onSwitched(zoneId, actuator, desired, await this.deps.setActuator(zoneId, actuator, desired));
  }
}
