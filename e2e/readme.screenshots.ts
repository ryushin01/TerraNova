import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { createAdmin, createUser, expect, Farm, signIn, test, useStack } from "./fixtures";
import { WEB_ORIGIN } from "./ports";
import { Stack } from "./stack";

const images = join(dirname(fileURLToPath(import.meta.url)), "../docs/images");

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(images, `${name}.jpg`), type: "jpeg", quality: 82 });
};

test.describe.configure({ mode: "serial" });

/** Regenerates the README's images: `bun run docs:screenshots`. Simulator data and test accounts only. */
test.describe("README screenshots", () => {
  const stack = useStack({ WATERING_DURATION_SEC: "12", WATERING_TIMES: "08:00,18:00" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1440, height: 1250 }, deviceScaleFactor: 1 });

    test("field status", async ({ page }) => {
      test.setTimeout(90_000);
      const farm = new Farm(page);
      await farm.open();

      await farm.plot("zone-b").click({ button: "right" });
      await farm.menuItem(farm.zoneMenu("zone-b"), "물 주기").click();
      await expect(farm.card("zone-b")).toContainText("물주기 완료", { timeout: 20_000 });
      await farm.expectToastsGone();

      await farm.toggle("zone-d", "vent");
      await stack.triggerAlarm("zone-c");
      await farm.plot("zone-a").click({ button: "right" });
      await farm.menuItem(farm.zoneMenu("zone-a"), "물 주기").click();
      await farm.expectLook("zone-a", "watering");
      await farm.expectLook("zone-c", "alarm");
      // The menus scrolled the page, and the pinned alerts would cover the fields.
      await page.evaluate(() => scrollTo(0, 0));
      await shoot(page, "field-status");

      await page.locator('[data-stop="zone-a"]').click();
      await expect(farm.card("zone-a")).toContainText("중지됨");
      await farm.confirmButton().click();
      await farm.expectLook("zone-c", "watering");
      await page.locator('[data-stop="zone-c"]').click();
      await expect(farm.card("zone-c")).toContainText("중지됨");
    });

    test("field menu", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await farm.plot("zone-b").click({ button: "right" });
      await expect(farm.zoneMenu("zone-b")).toBeVisible();
      await shoot(page, "field-menu");
    });

    test("drag selection and moving", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      const a = (await farm.card("zone-a").boundingBox())!;
      const b = (await farm.card("zone-b").boundingBox())!;
      await page.mouse.move(a.x - 14, a.y - 10);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 40, b.y + b.height - 90, { steps: 8 });
      await expect(page.locator("[data-marquee]")).toBeVisible();
      await shoot(page, "drag-select");
      await page.mouse.up();
      await expect(page.locator("[data-selection-count]")).toContainText("2");

      const rice = (await farm.section("rice").boundingBox())!;
      await page.mouse.move(a.x + 80, a.y + 140);
      await page.mouse.down();
      await page.mouse.move(rice.x + rice.width / 2, Math.min(rice.y + 120, 1100), { steps: 10 });
      await expect(farm.section("rice")).toHaveAttribute("data-drop-target", "true");
      await shoot(page, "drag-move");
      await page.keyboard.press("Escape");
      await page.mouse.up();
    });

    test("add a crop", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await page.locator("[data-add-crop]").click();
      await page.locator('[name="crop-name"]').fill("방울토마토");
      await expect(page.locator("[data-preview-icon]")).toHaveAttribute("data-preview-icon", "tomato");
      await shoot(page, "add-crop");
    });

    test("alarm times", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await page.locator('[data-section-times-edit="rice"]').click();
      await page.locator('[name="alarm-time"]').fill("12:30");
      await page.locator("[data-alarm-time-add]").click();
      await expect(page.locator("[data-alarm-time]")).toHaveCount(3);
      await shoot(page, "alarm-times");
    });

    test("users", async ({ page, context }) => {
      await createUser(context, {
        name: "김작업",
        email: "operator@terranova.test",
        password: "correct-horse-2",
        role: "operator",
      });
      await createUser(context, {
        name: "이조회",
        email: "viewer@terranova.test",
        password: "correct-horse-3",
        role: "viewer",
      });
      await page.setViewportSize({ width: 1440, height: 700 });
      await page.goto("/ko/users");
      await expect(page.locator('[data-user="viewer@terranova.test"]')).toBeVisible();
      await shoot(page, "users");
    });
  });

  test.describe("history", () => {
    test.use({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 1 });

    test("control history", async ({ page }) => {
      await page.goto("/ko/history");
      await expect(page.locator("[data-history-row]").first()).toBeVisible();
      await shoot(page, "history");
    });
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

    test("field", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await stack.triggerAlarm("zone-a");
      await farm.expectLook("zone-a", "alarm");
      await shoot(page, "mobile");
    });
  });
});

test.describe("README screenshots with recorded readings", () => {
  const stack = new Stack({ WATERING_TIMES: "08:00,18:00" });

  test.beforeAll(async () => {
    execFileSync("bun", [join(dirname(fileURLToPath(import.meta.url)), "seed-sensors.ts"), stack.dataDir]);
    await stack.start();
    await createAdmin();
  });
  test.afterAll(() => stack.stop());
  test.beforeEach(({ context }) => signIn(context));

  test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

  test("dark mode", async ({ browser }) => {
    const dark = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      baseURL: WEB_ORIGIN,
      colorScheme: "dark",
    });
    await signIn(dark);
    const page = await dark.newPage();
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-b");
    await farm.expectLook("zone-b", "alarm");
    await shoot(page, "dark");
    await dark.close();
  });

  test("sign in", async ({ browser }) => {
    const signedOut = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: WEB_ORIGIN,
    });
    const page = await signedOut.newPage();
    await page.goto("/ko/login");
    await expect(page.getByRole("button", { name: "로그인" })).toBeEnabled();
    await shoot(page, "login");
    await signedOut.close();
  });

  test("sensor history", async ({ page }) => {
    await page.goto("/ko/sensors");
    await expect(page.locator('[data-sensor-chart="soilMoisturePct"] .recharts-line')).toBeVisible();
    await shoot(page, "sensors");
  });

  test("automatic control", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator('[data-section-more="rice"]').click();
    await page.locator('[data-section-more-items="rice"]').getByRole("menuitem", { name: "자동 제어" }).click();
    await page.locator('[name="vent-on"]').fill("30");
    await page.locator('[name="vent-off"]').fill("25");
    await page.locator('[name="light-on"]').fill("06:00");
    await page.locator('[name="light-off"]').fill("18:00");
    await page.locator('[name="soil-alarm"]').fill("30");
    await page.evaluate(() => scrollTo(0, 0));
    await shoot(page, "automation");
  });
});
