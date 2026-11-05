import { randomUUID } from "node:crypto";
import {
  ACTIVE_WATERING_STATES,
  MAX_PUMP_DURATION_SEC,
  canTransition,
  topics,
  type Command,
  type CommandAck,
  type ConfirmResult,
  type WateringCycle,
  type WateringState,
} from "@terranova/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { wateringCycles, type WateringCycleRow } from "./db/schema";
import type { ZoneRegistry } from "./zones";

export interface WateringConfig {
  zoneIds: readonly string[];
  /** Daily local alarm times as HH:mm. */
  times: readonly string[];
  /** Extra repeating alarms for demonstrations. Off when not set. */
  alarmEveryMs?: number;
  timeZone: string;
  durationSec: number;
  soilSufficientPct: number;
  remindAfterMs: number;
  alarmTimeoutMs: number;
  ackTimeoutMs: number;
  completionGraceMs: number;
}

export interface WateringDeps {
  db: Database;
  zones: ZoneRegistry;
  config: WateringConfig;
  publish: (topic: string, payload: string) => Promise<void>;
  onCycleChange: (cycle: WateringCycle) => void;
  now?: () => Date;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toCycleDto(row: WateringCycleRow): WateringCycle {
  return {
    id: row.id,
    zoneId: row.zoneId,
    state: row.state,
    durationSec: row.durationSec,
    reason: row.reason,
    reminderCount: row.reminderCount,
    alarmSentAt: iso(row.alarmSentAt),
    expiresAt: iso(row.expiresAt),
    confirmedAt: iso(row.confirmedAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

/** Local slots due right now: their time has passed but the alarm would not yet have expired. */
export function dueSlots(now: Date, timeZone: string, times: readonly string[], windowMs: number): string[] {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const minutesNow = Number(parts.hour) * 60 + Number(parts.minute);

  return times
    .filter((time) => {
      const [hour, minute] = time.split(":").map(Number);
      const elapsedMs = (minutesNow - hour! * 60 - minute!) * 60_000;
      return elapsedMs >= 0 && elapsedMs < windowMs;
    })
    .map((time) => `${parts.year}-${parts.month}-${parts.day}T${time}`);
}

/**
 * The watering flow. Every state change is a conditional UPDATE, so only one caller can win
 * a transition, and all deadlines come from stored timestamps, so a restart loses nothing.
 */
export class WateringService {
  private readonly db: Database;
  private readonly zones: ZoneRegistry;
  private readonly config: WateringConfig;
  private readonly now: () => Date;

  constructor(private readonly deps: WateringDeps) {
    this.db = deps.db;
    this.zones = deps.zones;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    const { durationSec } = deps.config;
    if (!Number.isInteger(durationSec) || durationSec <= 0 || durationSec > MAX_PUMP_DURATION_SEC) {
      throw new Error(`durationSec must be a whole number from 1 to ${MAX_PUMP_DURATION_SEC}`);
    }
  }

  async latestCycles(): Promise<WateringCycle[]> {
    const rows = await this.db
      .selectDistinctOn([wateringCycles.zoneId])
      .from(wateringCycles)
      .orderBy(wateringCycles.zoneId, desc(wateringCycles.createdAt));
    return rows.map(toCycleDto);
  }

  /** Starts an alarm outside the schedule. Returns null if the zone already has an active cycle. */
  triggerAlarm(zoneId: string): Promise<WateringCycle | null> {
    return this.createAlarm(zoneId, `manual-${randomUUID()}`);
  }

  /** Called when a person confirms an alarm. Only the first confirmation can start the pump. */
  async confirm(cycleId: string, confirmedBy?: string): Promise<ConfirmResult> {
    const now = this.now();
    const [existing] = await this.db.select().from(wateringCycles).where(eq(wateringCycles.id, cycleId));
    if (!existing) return { ok: false, error: "not_found" };
    if (existing.expiresAt && existing.expiresAt <= now) return { ok: false, error: "already_handled" };

    const commandId = randomUUID();
    const confirmed = await this.move(cycleId, ["alarm_sent"], "confirmed", {
      confirmedAt: now,
      confirmedBy,
      commandId,
    });
    if (!confirmed) return { ok: false, error: "already_handled" };

    return this.dispatch(confirmed.id, confirmed.zoneId, confirmed.durationSec, commandId);
  }

  /**
   * A person asked to water this zone now. A waiting alarm is answered rather than duplicated,
   * and the database refuses a second cycle if one is already running.
   */
  async startWatering(zoneId: string, confirmedBy?: string): Promise<ConfirmResult> {
    const [active] = await this.db
      .select({ id: wateringCycles.id, state: wateringCycles.state })
      .from(wateringCycles)
      .where(and(eq(wateringCycles.zoneId, zoneId), inArray(wateringCycles.state, [...ACTIVE_WATERING_STATES])));
    if (active?.state === "alarm_sent") return this.confirm(active.id, confirmedBy);
    if (active) return { ok: false, error: "already_handled" };

    const commandId = randomUUID();
    const cycle = await this.insert({
      zoneId,
      slot: `manual-${randomUUID()}`,
      state: "confirmed",
      durationSec: this.config.durationSec,
      confirmedAt: this.now(),
      confirmedBy,
      commandId,
    });
    if (!cycle) return { ok: false, error: "already_handled" };
    return this.dispatch(cycle.id, zoneId, cycle.durationSec, commandId);
  }

  /** The checks every watering passes before the pump is told to start. */
  private async dispatch(
    cycleId: string,
    zoneId: string,
    durationSec: number,
    commandId: string,
  ): Promise<ConfirmResult> {
    const now = this.now();
    if (!this.zones.isOnline(zoneId, now.getTime())) {
      return this.finish(await this.endConfirmed(cycleId, "failed", "zone_offline"));
    }
    if ((this.zones.soilMoisture(zoneId) ?? 0) >= this.config.soilSufficientPct) {
      return this.finish(await this.endConfirmed(cycleId, "skipped", "soil_sufficient"));
    }

    const sent = await this.move(cycleId, ["confirmed"], "command_sent", { commandSentAt: now });
    if (!sent) return { ok: false, error: "already_handled" };

    try {
      await this.sendPumpCommand(zoneId, { commandId, action: "on", durationSec });
    } catch {
      const failed = await this.move(cycleId, ["command_sent"], "failed", {
        reason: "publish_failed",
        finishedAt: this.now(),
      });
      return this.finish(failed ?? sent);
    }
    return this.finish(sent);
  }

  /** Device reports are the only thing that can mark watering as started or finished. */
  async handleAck(ack: CommandAck): Promise<void> {
    if (ack.actuator !== "pump") return;
    const [cycle] = await this.db
      .select({ id: wateringCycles.id })
      .from(wateringCycles)
      .where(eq(wateringCycles.commandId, ack.commandId));
    if (!cycle) return;

    const now = this.now();
    if (ack.status === "accepted") {
      await this.move(cycle.id, ["command_sent"], "watering", { startedAt: now });
    } else if (ack.status === "completed") {
      await this.move(cycle.id, ["command_sent", "watering"], "completed", {
        finishedAt: now,
        reason: ack.reason ?? null,
      });
    } else {
      await this.move(cycle.id, ["command_sent", "watering"], "failed", {
        finishedAt: now,
        reason: ack.reason ?? ack.status,
      });
    }
  }

  /** Runs the schedule, reminders and every deadline. Safe to call repeatedly. */
  async tick(): Promise<void> {
    await this.createDueAlarms();

    const now = this.now();
    const nowMs = now.getTime();
    const active = await this.db
      .select()
      .from(wateringCycles)
      .where(inArray(wateringCycles.state, [...ACTIVE_WATERING_STATES]));

    for (const cycle of active) {
      if (cycle.state === "alarm_sent") {
        await this.tickAlarm(cycle, now);
      } else if (cycle.state === "confirmed") {
        if (cycle.confirmedAt && nowMs - cycle.confirmedAt.getTime() > this.config.ackTimeoutMs) {
          await this.move(cycle.id, ["confirmed"], "failed", { reason: "command_not_sent", finishedAt: now });
        }
      } else if (cycle.state === "command_sent") {
        if (cycle.commandSentAt && nowMs - cycle.commandSentAt.getTime() > this.config.ackTimeoutMs) {
          await this.failAndStopPump(cycle, ["command_sent"], "no_ack", now);
        }
      } else if (cycle.startedAt) {
        const deadline = cycle.startedAt.getTime() + cycle.durationSec * 1000 + this.config.completionGraceMs;
        if (nowMs > deadline) await this.failAndStopPump(cycle, ["watering"], "no_completion", now);
      }
    }
  }

  private async tickAlarm(cycle: WateringCycleRow, now: Date): Promise<void> {
    // Nobody answered: record it and never water on our own.
    if (cycle.expiresAt && cycle.expiresAt <= now) {
      await this.move(cycle.id, ["alarm_sent"], "timed_out", { reason: "alarm_unanswered", finishedAt: now });
      return;
    }
    if (cycle.nextReminderAt && cycle.nextReminderAt <= now) {
      await this.move(cycle.id, ["alarm_sent"], "alarm_sent", {
        reminderCount: cycle.reminderCount + 1,
        nextReminderAt: new Date(now.getTime() + this.config.remindAfterMs),
      });
    }
  }

  private async createDueAlarms(): Promise<void> {
    const { alarmEveryMs } = this.config;
    const slots = dueSlots(this.now(), this.config.timeZone, this.config.times, this.config.alarmTimeoutMs);
    if (alarmEveryMs) slots.push(`every-${alarmEveryMs}-${Math.floor(this.now().getTime() / alarmEveryMs)}`);
    if (slots.length === 0) return;

    const existing = await this.db
      .select({ zoneId: wateringCycles.zoneId, slot: wateringCycles.slot })
      .from(wateringCycles)
      .where(inArray(wateringCycles.slot, slots));
    const done = new Set(existing.map((row) => `${row.zoneId}|${row.slot}`));

    for (const slot of slots) {
      for (const zoneId of this.config.zoneIds) {
        if (!done.has(`${zoneId}|${slot}`)) await this.createScheduledCycle(zoneId, slot);
      }
    }
  }

  private async createScheduledCycle(zoneId: string, slot: string): Promise<void> {
    const soil = this.zones.soilMoisture(zoneId);
    const online = this.zones.isOnline(zoneId, this.now().getTime());
    if (online && soil !== null && soil >= this.config.soilSufficientPct) {
      await this.insert({
        zoneId,
        slot,
        state: "skipped",
        reason: "soil_sufficient",
        durationSec: this.config.durationSec,
        finishedAt: this.now(),
      });
      return;
    }
    await this.createAlarm(zoneId, slot);
  }

  private async createAlarm(zoneId: string, slot: string): Promise<WateringCycle | null> {
    const now = this.now();
    return this.insert({
      zoneId,
      slot,
      state: "alarm_sent",
      durationSec: this.config.durationSec,
      alarmSentAt: now,
      nextReminderAt: new Date(now.getTime() + this.config.remindAfterMs),
      expiresAt: new Date(now.getTime() + this.config.alarmTimeoutMs),
    });
  }

  private async insert(values: typeof wateringCycles.$inferInsert): Promise<WateringCycle | null> {
    const [row] = await this.db
      .insert(wateringCycles)
      .values({ ...values, createdAt: this.now() })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    const cycle = toCycleDto(row);
    this.deps.onCycleChange(cycle);
    return cycle;
  }

  private endConfirmed(cycleId: string, state: "failed" | "skipped", reason: string) {
    return this.move(cycleId, ["confirmed"], state, { reason, finishedAt: this.now() });
  }

  private finish(row: WateringCycleRow | null): ConfirmResult {
    return row ? { ok: true, cycle: toCycleDto(row) } : { ok: false, error: "already_handled" };
  }

  /**
   * Without a report we cannot know the pump's real state, so it is told to stop. A retained
   * on-command that arrives late is followed by this off-command, because MQTT keeps order.
   */
  private async failAndStopPump(
    cycle: WateringCycleRow,
    from: WateringState[],
    reason: string,
    now: Date,
  ): Promise<void> {
    const failed = await this.move(cycle.id, from, "failed", { reason, finishedAt: now });
    if (!failed) return;
    try {
      await this.sendPumpCommand(cycle.zoneId, { commandId: randomUUID(), action: "off" });
    } catch (error) {
      console.error(`[watering] could not send stop to ${cycle.zoneId}:`, error);
    }
  }

  private sendPumpCommand(zoneId: string, command: Command): Promise<void> {
    return this.deps.publish(topics.command(zoneId, "pump"), JSON.stringify(command));
  }

  private async move(
    id: string,
    from: WateringState[],
    to: WateringState,
    patch: Partial<typeof wateringCycles.$inferInsert> = {},
  ): Promise<WateringCycleRow | null> {
    for (const state of from) {
      if (state !== to && !canTransition(state, to)) {
        throw new Error(`Invalid watering transition: ${state} -> ${to}`);
      }
    }
    const [row] = await this.db
      .update(wateringCycles)
      .set({ ...patch, state: to })
      .where(and(eq(wateringCycles.id, id), inArray(wateringCycles.state, from)))
      .returning();
    if (!row) return null;
    this.deps.onCycleChange(toCycleDto(row));
    return row;
  }
}
