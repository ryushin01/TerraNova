import type { WateringCycle } from "@terranova/shared";
import { eq, inArray } from "drizzle-orm";
import { sendNotification } from "web-push";
import type { Database } from "./db";
import { pushSubscriptions } from "./db/schema";

/** Push services of the major browsers. The server sends requests to these addresses. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

/**
 * Subscriptions come from clients, and the server then makes requests to them. Accepting any
 * address would let a user aim the server at internal machines.
 */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type SendPush = (subscription: Subscription, payload: string) => Promise<unknown>;

export function parseSubscription(body: Record<string, unknown> | null): Subscription | null {
  const keys = body?.keys as Record<string, unknown> | undefined;
  const valid =
    isPushEndpoint(body?.endpoint) &&
    typeof keys?.p256dh === "string" &&
    typeof keys?.auth === "string" &&
    keys.p256dh.length <= 256 &&
    keys.auth.length <= 256;
  return valid
    ? { endpoint: body!.endpoint as string, keys: { p256dh: keys!.p256dh as string, auth: keys!.auth as string } }
    : null;
}

const MESSAGES = {
  ko: {
    alarm: (zone: string) => ({ title: "물 줄 시간이에요", body: `${zone} 구역을 확인해 주세요.` }),
    timeout: (zone: string) => ({ title: "알람 시간 초과", body: `${zone} 구역에 물을 주지 않았어요.` }),
  },
  en: {
    alarm: (zone: string) => ({ title: "Time to water", body: `Please check zone ${zone}.` }),
    timeout: (zone: string) => ({ title: "Alarm timed out", body: `Zone ${zone} was not watered.` }),
  },
} as const;

const MAX_AGE_SEC = 60 * 60;

/** Sends alarms to devices that asked for them, so people hear about one with the page closed. */
export class PushNotifier {
  private readonly send: SendPush;

  constructor(
    private readonly db: Database,
    private readonly config: PushConfig,
    send?: SendPush,
  ) {
    this.send =
      send ??
      ((subscription, payload) =>
        sendNotification(subscription, payload, {
          TTL: MAX_AGE_SEC,
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        }));
  }

  get publicKey(): string {
    return this.config.publicKey;
  }

  /** An endpoint belongs to one browser, so the latest person to sign in there owns it. */
  async subscribe(userId: string, subscription: Subscription, locale: string): Promise<void> {
    const values = {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      locale: locale === "en" ? "en" : "ko",
    };
    await this.db
      .insert(pushSubscriptions)
      .values({ endpoint: subscription.endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async notify(cycle: WateringCycle): Promise<void> {
    const kind = cycle.state === "alarm_sent" ? "alarm" : cycle.state === "timed_out" ? "timeout" : null;
    if (!kind) return;

    const zone = cycle.zoneId.replace("zone-", "").toUpperCase();
    const rows = await this.db.select().from(pushSubscriptions);
    const gone: string[] = [];

    await Promise.all(
      rows.map(async (row) => {
        const locale = row.locale === "en" ? "en" : "ko";
        const payload = JSON.stringify({
          ...MESSAGES[locale][kind](zone),
          // One notification per zone: a reminder replaces the earlier one rather than piling up.
          tag: `zone-${zone}`,
          url: `/${locale}`,
        });
        try {
          await this.send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The push service says this subscription no longer exists.
          if (status === 404 || status === 410) gone.push(row.endpoint);
          else console.error(`[push] send failed: ${status ?? (error as Error).message}`);
        }
      }),
    );

    if (gone.length > 0) await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone));
  }
}
