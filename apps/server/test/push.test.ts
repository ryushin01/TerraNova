import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { WateringCycle } from "@terranova/shared";
import { createAuth } from "../src/auth";
import { openDatabase } from "../src/db";
import { pushSubscriptions } from "../src/db/schema";
import { PushNotifier, isPushEndpoint, parseSubscription, type Subscription } from "../src/push";

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const KEYS = { p256dh: "p".repeat(20), auth: "a".repeat(10) };

const cycle = (state: WateringCycle["state"], zoneId = "zone-a") => ({ zoneId, state }) as WateringCycle;

describe("which addresses are accepted", () => {
  test.each([
    FCM,
    "https://web.push.apple.com/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("allows %s", (url) => expect(isPushEndpoint(url)).toBe(true));

  test.each([
    "http://fcm.googleapis.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost:4000/api",
    "https://127.0.0.1/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilpush.apple.com/x",
    "https://fcm.googleapis.com:8443/x",
    "file:///etc/passwd",
    "not a url",
    7,
    null,
  ])("refuses %p", (url) => expect(isPushEndpoint(url)).toBe(false));

  test("subscriptions must be complete", () => {
    expect(parseSubscription({ endpoint: FCM, keys: KEYS })).toEqual({ endpoint: FCM, keys: KEYS });
    expect(parseSubscription({ endpoint: FCM })).toBeNull();
    expect(parseSubscription({ endpoint: FCM, keys: { p256dh: 1, auth: 2 } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://evil.example/x", keys: KEYS })).toBeNull();
    expect(parseSubscription({ endpoint: FCM, keys: { p256dh: "x".repeat(257), auth: "a" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe("sending", () => {
  let database: Awaited<ReturnType<typeof openDatabase>>;
  let sent: { subscription: Subscription; payload: any }[];
  let failWith: number | null;
  let notifier: PushNotifier;
  let userId: string;

  beforeEach(async () => {
    database = await openDatabase();
    const auth = createAuth({ db: database.db, baseURL: "http://localhost:3000", secret: "s".repeat(40), trustedOrigins: [] });
    const created = await auth.api.createUser({ body: { name: "A", email: "a@t.test", password: "correct-horse-1", role: "viewer" } });
    userId = created.user.id;
    sent = [];
    failWith = null;
    notifier = new PushNotifier(database.db, { publicKey: "pub", privateKey: "priv", subject: "https://example.com" }, async (subscription, payload) => {
      if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
      sent.push({ subscription, payload: JSON.parse(payload) });
    });
    await notifier.subscribe(userId, { endpoint: FCM, keys: KEYS }, "ko");
  });

  afterEach(() => database.close());

  const stored = async () => (await database.db.select().from(pushSubscriptions)).length;

  test("an alarm and a time-out reach subscribers in their language", async () => {
    await notifier.notify(cycle("alarm_sent", "zone-c"));
    expect(sent[0]?.payload).toEqual({ title: "물 줄 시간이에요", body: "C 구역을 확인해 주세요.", tag: "zone-C", url: "/ko" });

    await notifier.subscribe(userId, { endpoint: FCM, keys: KEYS }, "en");
    await notifier.notify(cycle("timed_out", "zone-c"));
    expect(sent[1]?.payload).toEqual({ title: "Alarm timed out", body: "Zone C was not watered.", tag: "zone-C", url: "/en" });
  });

  test.each(["confirmed", "command_sent", "watering", "completed", "failed", "skipped"] as const)("%s sends nothing", async (state) => {
    await notifier.notify(cycle(state));
    expect(sent).toHaveLength(0);
  });

  test("a browser that subscribes again replaces its record", async () => {
    await notifier.subscribe(userId, { endpoint: FCM, keys: KEYS }, "ko");
    expect(await stored()).toBe(1);
  });

  test.each([404, 410])("a %i from the push service removes the subscription", async (status) => {
    failWith = status;
    await notifier.notify(cycle("alarm_sent"));
    expect(await stored()).toBe(0);
  });

  test("other failures keep the subscription and don't throw", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    failWith = 500;
    await notifier.notify(cycle("alarm_sent"));
    expect(await stored()).toBe(1);
    logged.mockRestore();
  });

  test("unsubscribing stops delivery", async () => {
    await notifier.unsubscribe(FCM);
    await notifier.notify(cycle("alarm_sent"));
    expect(sent).toHaveLength(0);
  });

  test("removing the account removes its subscriptions", async () => {
    const { user } = await import("../src/db/schema");
    await database.db.delete(user);
    expect(await stored()).toBe(0);
  });
});
