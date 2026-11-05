import type { ConfirmResult, HistoryAction, HistoryDetail, HistoryEntry, HistoryPage } from "@terranova/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Database } from "./db";
import { controlEvents } from "./db/schema";

const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_HISTORY_LIMIT = 100;

export interface Actor {
  id: string;
  name: string;
  role: string | null | undefined;
}

export interface HistoryEvent {
  action: HistoryAction;
  zoneId?: string;
  detail?: HistoryDetail;
  result: string;
  reason?: string | null;
}

export interface HistoryFilter {
  before?: number;
  zoneId?: string;
  action?: HistoryAction;
  limit: number;
}

/** What a result means for the record: where a watering request ended up, or why it was refused. */
export function outcomeOf(result: { ok: boolean; error?: string; cycle?: ConfirmCycle }): {
  result: string;
  reason?: string | null;
} {
  if (!result.ok) return { result: result.error ?? "internal" };
  if (!result.cycle) return { result: "ok" };
  const { state, reason } = result.cycle;
  return { result: state === "command_sent" ? "sent" : state, reason };
}

type ConfirmCycle = Extract<ConfirmResult, { ok: true }>["cycle"];

/** Who did what. People's names are copied in, so records outlive the accounts behind them. */
export class ControlHistory {
  constructor(private readonly db: Database) {}

  /** Never throws: failing to write a record must not get in the way of operating a device. */
  async record(actor: Actor, events: HistoryEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.db.insert(controlEvents).values(
        events.map((event) => ({
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role ?? "",
          action: event.action,
          zoneId: event.zoneId ?? null,
          detail: event.detail ?? {},
          result: event.result,
          reason: event.reason ?? null,
        })),
      );
    } catch (error) {
      console.error("[history] could not record:", error);
    }
  }

  async list({ before, zoneId, action, limit }: HistoryFilter): Promise<Pick<HistoryPage, "entries" | "nextBefore">> {
    const rows = await this.db
      .select()
      .from(controlEvents)
      .where(
        and(
          before === undefined ? undefined : lt(controlEvents.id, before),
          zoneId ? eq(controlEvents.zoneId, zoneId) : undefined,
          action ? eq(controlEvents.action, action) : undefined,
        ),
      )
      .orderBy(desc(controlEvents.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const entries: HistoryEntry[] = page.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actorName: row.actorName,
      actorRole: row.actorRole,
      action: row.action,
      zoneId: row.zoneId,
      detail: row.detail,
      result: row.result,
      reason: row.reason,
    }));
    return { entries, nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  /** Removes records past the retention period, so the table can't grow without limit. */
  async prune(now = new Date()): Promise<void> {
    await this.db.delete(controlEvents).where(lt(controlEvents.at, new Date(now.getTime() - RETENTION_DAYS * DAY_MS)));
  }
}
