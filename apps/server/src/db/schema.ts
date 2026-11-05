import type { CropIconKey, HistoryAction, HistoryDetail, WateringState } from "@terranova/shared";
import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const wateringCycles = pgTable(
  "watering_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: text("zone_id").notNull(),
    /** Local schedule slot such as 2026-11-05T08:00, so a slot alarms only once. */
    slot: text("slot").notNull(),
    state: text("state").$type<WateringState>().notNull(),
    durationSec: integer("duration_sec").notNull(),
    commandId: text("command_id").unique(),
    reason: text("reason"),
    confirmedBy: text("confirmed_by"),
    reminderCount: integer("reminder_count").notNull().default(0),
    alarmSentAt: time("alarm_sent_at"),
    nextReminderAt: time("next_reminder_at"),
    expiresAt: time("expires_at"),
    confirmedAt: time("confirmed_at"),
    commandSentAt: time("command_sent_at"),
    startedAt: time("started_at"),
    finishedAt: time("finished_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("watering_cycles_zone_slot").on(table.zoneId, table.slot),
    // The database itself guarantees a zone never has two cycles in progress.
    uniqueIndex("watering_cycles_one_active_per_zone")
      .on(table.zoneId)
      .where(sql`${table.state} in ('alarm_sent', 'confirmed', 'command_sent', 'watering')`),
  ],
);

export type WateringCycleRow = typeof wateringCycles.$inferSelect;

export const crops = pgTable(
  "crops",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon").$type<CropIconKey>().notNull(),
    /** Display order of sections. */
    position: integer("position").notNull().default(0),
    /** Null follows the default alarm times. An empty list means no alarms. */
    alarmTimes: jsonb("alarm_times").$type<string[]>(),
    scheduleUpdatedAt: time("schedule_updated_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("crops_name_unique").on(sql`lower(${table.name})`)],
);

export const zoneSections = pgTable("zone_sections", {
  zoneId: text("zone_id").primaryKey(),
  // No cascade: a crop that still has zones must not be deletable.
  crop: text("crop")
    .notNull()
    .references(() => crops.id),
});

export const controlEvents = pgTable(
  "control_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: time("at").notNull().defaultNow(),
    // Not a foreign key, and the name is a copy: records must outlive the account.
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").$type<HistoryAction>().notNull(),
    zoneId: text("zone_id"),
    detail: jsonb("detail").$type<HistoryDetail>().notNull().default({}),
    result: text("result").notNull(),
    reason: text("reason"),
  },
  (table) => [index("control_events_at").on(table.at), index("control_events_zone").on(table.zoneId, table.id)],
);

// Tables used by Better Auth, with the fields its admin plugin adds.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: time("ban_expires"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: time("access_token_expires_at"),
  refreshTokenExpiresAt: time("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  locale: text("locale").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
