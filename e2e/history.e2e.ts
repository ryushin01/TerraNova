import { createAdmin, createUser, expect, expectFitsScreen, Farm, signIn, test, useStack } from "./fixtures";
import { WEB_ORIGIN } from "./ports";

test.describe.configure({ mode: "serial" });

test.describe("control history", () => {
  const stack = useStack({ WATERING_DURATION_SEC: "30" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("operations made on the dashboard appear with who did them", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();

    await farm.toggle("zone-a", "vent");
    await expect(farm.switchInput("zone-a", "vent")).toBeChecked();

    await farm.plot("zone-b").click({ button: "right" });
    await farm.menuItem(farm.zoneMenu("zone-b"), "물 주기").click();
    await farm.expectLook("zone-b", "watering");
    await page.locator('[data-stop="zone-b"]').click();
    await expect(farm.card("zone-b")).toContainText("중지됨");

    await stack.triggerAlarm("zone-c");
    await farm.confirmButton().click();
    await farm.expectLook("zone-c", "watering");
    await page.locator('[data-stop="zone-c"]').click();
    await expect(farm.card("zone-c")).toContainText("중지됨");

    await farm.plot("zone-f").click({ button: "right" });
    await farm.menuItem(farm.zoneMenu("zone-f"), "벼 섹션으로 이동").click();
    await expect(farm.section("rice").locator('[data-zone="zone-f"]')).toBeVisible();

    await farm.goTo("제어 이력");
    await expect(page).toHaveURL(/\/ko\/history$/);

    const row = (action: string) => page.locator(`[data-history-row="${action}"]`);
    await expect(row("actuator_set").first()).toContainText("환기 켜기");
    await expect(row("actuator_set").first()).toContainText("관리자");
    await expect(row("actuator_set").first()).toHaveAttribute("data-result", "ok");
    await expect(row("watering_start").first()).toContainText("명령 전송");
    await expect(row("alarm_confirm").first()).toContainText("알람 확인");
    await expect(row("pump_stop")).toHaveCount(2);
    await expect(row("zones_move").first()).toContainText("벼 섹션으로 이동");
    await expect(page.locator("[data-history-row]").first()).toHaveAttribute("data-history-row", "zones_move");
  });

  test("filters narrow the list, and refresh picks up new records", async ({ page, browser }) => {
    await page.goto("/ko/history");
    await expect(page.locator("[data-history-row]").first()).toBeVisible();

    await page.locator('[name="history-zone"]').selectOption("zone-b");
    await expect(page.locator("[data-history-row]")).toHaveCount(2);
    await page.locator('[name="history-action"]').selectOption("pump_stop");
    await expect(page.locator("[data-history-row]")).toHaveCount(1);
    await page.locator('[name="history-zone"]').selectOption("zone-e");
    await expect(page.locator("[data-history-empty]")).toBeVisible();

    await page.locator('[name="history-zone"]').selectOption("");
    await page.locator('[name="history-action"]').selectOption("actuator_set");
    await expect(page.locator("[data-history-row]")).toHaveCount(1);

    const other = await browser.newContext({ baseURL: WEB_ORIGIN });
    await signIn(other);
    const otherPage = await other.newPage();
    const farm = new Farm(otherPage);
    await farm.open();
    await farm.toggle("zone-d", "light");
    await expect(farm.switchInput("zone-d", "light")).toBeChecked();
    await other.close();

    await page.locator("[data-history-refresh]").click();
    await expect(page.locator("[data-history-row]")).toHaveCount(2);
    await expect(page.locator("[data-history-row]").first()).toContainText("조명 켜기");
  });

  test("long histories load more on request", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    for (let index = 0; index < 26; index++) {
      await farm.toggle("zone-e", "vent");
      await expect(farm.switchInput("zone-e", "vent")).toBeChecked({ checked: index % 2 === 0 });
      await farm.toggle("zone-e", "light");
      await expect(farm.switchInput("zone-e", "light")).toBeChecked({ checked: index % 2 === 0 });
    }
    await page.goto("/ko/history");
    await expect(page.locator("[data-history-row]")).toHaveCount(50);
    await page.locator("[data-history-more]").click();
    await expect.poll(() => page.locator("[data-history-row]").count()).toBeGreaterThan(50);
    await expect(page.locator("[data-history-more]")).toHaveCount(0);
  });

  test("viewers and signed-out visitors can't read the history", async ({ browser, context, page }) => {
    await createUser(context, {
      name: "이조회",
      email: "viewer@terranova.test",
      password: "correct-horse-2",
      role: "viewer",
    });
    const viewerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    await signIn(viewerContext, "viewer@terranova.test", "correct-horse-2");
    const viewerPage = await viewerContext.newPage();
    const farm = new Farm(viewerPage);
    await farm.open();

    await expect(farm.navLink("제어 이력")).toHaveCount(0);
    await viewerPage.goto("/ko/history");
    await expect(viewerPage.getByText("관리자와 작업자만")).toBeVisible();
    expect((await viewerContext.request.get("/api/history")).status()).toBe(403);
    await viewerContext.close();

    expect(
      (await browser.newContext({ baseURL: WEB_ORIGIN }).then((c) => c.request.get("/api/history"))).status(),
    ).toBe(401);

    await page.goto("/ko/history");
    await expect(page.locator("[data-history-row]").first()).toBeVisible();
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("fits the screen", async ({ page }) => {
      await page.goto("/ko/history");
      await expect(page.locator("[data-history-row]").first()).toBeVisible();
      await expectFitsScreen(page);
    });
  });

  test("English shows translated labels and built-in section names", async ({ page }) => {
    await page.goto("/en/history");
    await expect(page.getByRole("columnheader", { name: "User" })).toBeVisible();
    await page.locator('[name="history-action"]').selectOption("zones_move");
    await expect(page.locator("[data-history-row]").first()).toContainText("Move to Rice");
  });
});
