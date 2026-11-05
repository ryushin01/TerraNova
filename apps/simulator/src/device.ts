import {
  MAX_PUMP_DURATION_SEC,
  type AckStatus,
  type Actuator,
  type Command,
  type CommandAck,
  type Telemetry,
} from "@terranova/shared";

const MAX_REMEMBERED_COMMANDS = 1000;
const OUTSIDE_TEMPERATURE_C = 18;
const OUTSIDE_HUMIDITY_PCT = 45;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10) / 10;

export interface DeviceOptions {
  zoneId: string;
  /** Probability from 0 to 1 that a pump start fails, for exercising failure handling. */
  pumpFailRate?: number;
  random?: () => number;
  /** Soil moisture lost per second while not watering. */
  soilDryRate?: number;
  /** Starting soil moisture. Random when not set; browser tests fix it to be repeatable. */
  initialSoil?: number;
}

/** One simulated zone. Pure apart from the injected clock values and random source. */
export class ZoneDevice {
  readonly zoneId: string;
  private readonly pumpFailRate: number;
  private readonly random: () => number;
  private readonly soilDryRate: number;
  private temperatureC: number;
  private humidityPct: number;
  private soilMoisturePct: number;
  private readonly actuators: Record<Actuator, boolean> = { pump: false, vent: false, light: false };
  private pumpRun: { commandId: string; endsAt: number } | null = null;
  private readonly lastAcks = new Map<string, CommandAck>();

  constructor({ zoneId, pumpFailRate = 0, random = Math.random, soilDryRate = 0.02, initialSoil }: DeviceOptions) {
    this.soilDryRate = soilDryRate;
    this.zoneId = zoneId;
    this.pumpFailRate = pumpFailRate;
    this.random = random;
    this.temperatureC = 22 + random() * 6;
    this.humidityPct = 50 + random() * 20;
    this.soilMoisturePct = initialSoil ?? 35 + random() * 30;
  }

  handleCommand(actuator: Actuator, command: Command, nowMs: number): CommandAck[] {
    const previous = this.lastAcks.get(command.commandId);
    if (previous) return [previous];

    if (actuator === "pump") return this.handlePump(command, nowMs);

    this.actuators[actuator] = command.action === "on";
    return [this.ack(command.commandId, actuator, "completed", nowMs)];
  }

  /** Advances the simulation. Returns acks for pump runs that ended during this step. */
  tick(dtSec: number, nowMs: number): CommandAck[] {
    const acks: CommandAck[] = [];
    if (this.pumpRun && nowMs >= this.pumpRun.endsAt) {
      acks.push(this.stopPump(nowMs, "duration_elapsed"));
    }

    const { pump, vent, light } = this.actuators;
    const noise = () => (this.random() - 0.5) * 0.1;

    this.soilMoisturePct += (pump ? 1.5 : -this.soilDryRate) * dtSec + noise();
    const targetTemperature = vent ? OUTSIDE_TEMPERATURE_C : light ? 30 : 26;
    this.temperatureC += (targetTemperature - this.temperatureC) * 0.01 * dtSec + noise();
    const targetHumidity = vent ? OUTSIDE_HUMIDITY_PCT : pump ? 85 : 65;
    this.humidityPct += (targetHumidity - this.humidityPct) * 0.01 * dtSec + noise();

    this.soilMoisturePct = clamp(this.soilMoisturePct, 0, 100);
    this.humidityPct = clamp(this.humidityPct, 0, 100);
    return acks;
  }

  telemetry(nowMs: number): Telemetry {
    return {
      zoneId: this.zoneId,
      timestamp: new Date(nowMs).toISOString(),
      temperatureC: round(this.temperatureC),
      humidityPct: round(this.humidityPct),
      soilMoisturePct: round(this.soilMoisturePct),
      actuators: { ...this.actuators },
    };
  }

  private handlePump(command: Command, nowMs: number): CommandAck[] {
    if (command.action === "off") {
      const acks: CommandAck[] = this.pumpRun ? [this.stopPump(nowMs, "stopped_by_command")] : [];
      acks.push(this.ack(command.commandId, "pump", "completed", nowMs));
      return acks;
    }

    if (this.pumpRun) {
      return [this.ack(command.commandId, "pump", "rejected", nowMs, "already_running")];
    }
    if (this.random() < this.pumpFailRate) {
      return [this.ack(command.commandId, "pump", "failed", nowMs, "pump_fault")];
    }

    const durationSec = Math.min(command.durationSec ?? MAX_PUMP_DURATION_SEC, MAX_PUMP_DURATION_SEC);
    this.actuators.pump = true;
    this.pumpRun = { commandId: command.commandId, endsAt: nowMs + durationSec * 1000 };
    return [this.ack(command.commandId, "pump", "accepted", nowMs)];
  }

  private stopPump(nowMs: number, reason: string): CommandAck {
    const { commandId } = this.pumpRun!;
    this.actuators.pump = false;
    this.pumpRun = null;
    return this.ack(commandId, "pump", "completed", nowMs, reason);
  }

  private ack(
    commandId: string,
    actuator: Actuator,
    status: AckStatus,
    nowMs: number,
    reason?: string,
  ): CommandAck {
    const ack: CommandAck = {
      commandId,
      zoneId: this.zoneId,
      actuator,
      status,
      timestamp: new Date(nowMs).toISOString(),
      ...(reason ? { reason } : {}),
    };
    this.lastAcks.delete(commandId);
    this.lastAcks.set(commandId, ack);
    if (this.lastAcks.size > MAX_REMEMBERED_COMMANDS) {
      const oldest = this.lastAcks.keys().next().value;
      if (oldest !== undefined) this.lastAcks.delete(oldest);
    }
    return ack;
  }
}
