import type { Page } from "@playwright/test";
import { Farm, createAdmin, expect, signIn, test, useStack } from "./fixtures";

/**
 * Real service worker and real notifications, with one substitution: the browser's subscription.
 * Getting one needs the browser vendor's push service, which a test shouldn't depend on.
 */
const fakeSubscription = () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test",
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }),
    unsubscribe: async () => {
      localStorage.removeItem("e2e-subscribed");
      return true;
    },
  };
  PushManager.prototype.subscribe = async function () {
    localStorage.setItem("e2e-subscribed", "1");
    return subscription as never;
  };
  PushManager.prototype.getSubscription = async function () {
    return (localStorage.getItem("e2e-subscribed") ? subscription : null) as never;
  };
};

const menuItem = async (farm: Farm, name: string) => (await farm.openAccountMenu()).getByRole("menuitem", { name });

const notifications = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const shown = (await registration?.getNotifications()) ?? [];
    return shown.map(({ title, body, tag }) => ({ title, body, tag }));
  });

test.describe.configure({ mode: "serial" });

test.describe("alarm notifications", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await context.addInitScript(fakeSubscription);
  });

  test("turning them on registers the worker, which shows a pushed alarm", async ({ page, context }) => {
    await context.grantPermissions(["notifications"], { origin: "http://localhost:3000" });
    const farm = new Farm(page);
    await farm.open();

    await (await menuItem(farm, "알림 켜기")).click();
    await expect(page.getByText("알림을 켰어요")).toBeVisible();

    const cdp = await context.newCDPSession(page);
    const registered = new Promise<string>((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const worker = registrations.find((registration) => registration.scopeURL.startsWith("http://localhost:3000"));
        if (worker) resolve(worker.registrationId);
      });
    });
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: "http://localhost:3000",
      registrationId: await registered,
      data: JSON.stringify({ title: "물 줄 시간이에요", body: "A 구역을 확인해 주세요.", tag: "zone-A", url: "/ko" }),
    });
    await expect
      .poll(() => notifications(page))
      .toContainEqual({ title: "물 줄 시간이에요", body: "A 구역을 확인해 주세요.", tag: "zone-A" });
  });

  test("the menu reflects the state, and they can be turned off", async ({ page, context }) => {
    await context.grantPermissions(["notifications"], { origin: "http://localhost:3000" });
    const farm = new Farm(page);
    await farm.open();
    await (await menuItem(farm, "알림 켜기")).click();
    await expect(page.getByText("알림을 켰어요")).toBeVisible();
    await (await menuItem(farm, "알림 끄기")).click();
    await expect(page.getByText("알림을 껐어요")).toBeVisible();
    await expect(await menuItem(farm, "알림 켜기")).toBeVisible();
  });

  test("refused permission says so instead of failing silently", async ({ page }) => {
    await page.addInitScript(() => {
      Notification.requestPermission = async () => "denied";
    });
    const farm = new Farm(page);
    await farm.open();
    await (await menuItem(farm, "알림 켜기")).click();
    await expect(page.getByText("브라우저 설정에서 알림을 허용")).toBeVisible();
    await expect(await menuItem(farm, "알림 켜기")).toBeVisible();
  });

  test("a certificate the browser won't accept explains itself", async ({ page, context }) => {
    await context.grantPermissions(["notifications"], { origin: "http://localhost:3000" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator.serviceWorker, "register", {
        value: async () => {
          throw new DOMException("An SSL certificate error occurred", "SecurityError");
        },
      });
    });
    const farm = new Farm(page);
    await farm.open();
    await (await menuItem(farm, "알림 켜기")).click();
    await expect(page.getByText("이 환경에서는 알림을 켤 수 없어요")).toBeVisible();
  });

  test("the worker script is served fresh", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toContain("no-cache");
  });
});
