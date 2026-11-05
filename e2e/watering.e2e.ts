import { Farm, createAdmin, expect, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("watering on dry soil", () => {
  const stack = useStack({ WATERING_DURATION_SEC: "6" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("live values keep changing without a reload", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.card("zone-a").locator("[data-cell]")).toHaveCount(32);
    const before = await farm.card("zone-a").innerText();
    await expect.poll(() => farm.card("zone-a").innerText(), { timeout: 15_000 }).not.toBe(before);
  });

  test("alarm to completion, with the field changing color at each step", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.expectLook("zone-a", "dry");
    const dry = await farm.cellColor("zone-a");

    await stack.triggerAlarm("zone-a");
    await farm.expectLook("zone-a", "alarm");
    await expect(farm.firstCell("zone-a")).toHaveCSS("animation-name", /cellAlarm/);
    const alarm = await farm.cellColor("zone-a");

    await farm.confirmButton().click();
    await farm.expectLook("zone-a", "watering");
    await expect(farm.firstCell("zone-a")).toHaveCSS("animation-name", /cellWater/);
    const watering = await farm.cellColor("zone-a");
    await expect(page.locator('[data-stop="zone-a"]')).toBeVisible();
    await expect(farm.confirmButton()).toHaveCount(0);

    await farm.expectLook("zone-a", "completed");
    await expect(farm.card("zone-a")).toContainText("물주기 완료");
    await expect(page.getByText("A 구역 물주기 완료")).toBeVisible();
    const completed = await farm.cellColor("zone-a");
    await expect(farm.firstCell("zone-a")).toHaveCSS("animation-name", "none");

    expect(new Set([dry, alarm, watering, completed]).size).toBe(4);
  });

  test("the watering wave spreads across the field", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-c");
    await farm.confirmButton().click();
    await farm.expectLook("zone-c", "watering");
    const delay = (index: number) =>
      farm.card("zone-c").locator("[data-cell]").nth(index).evaluate((cell) => getComputedStyle(cell).animationDelay);
    expect(await delay(0)).not.toBe(await delay(9));
    await page.locator('[data-stop="zone-c"]').click();
    await expect(farm.card("zone-c")).toContainText("중지됨");
  });

  test("stopping ends watering early and isn't shown as completed", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-b");
    await farm.confirmButton().click();
    await farm.expectLook("zone-b", "watering");
    await page.locator('[data-stop="zone-b"]').click();
    await expect(farm.card("zone-b")).toContainText("사용자가 중지");
    await expect(page.locator('[data-stop="zone-b"]')).toHaveCount(0);
    await expect(farm.field("zone-b")).not.toHaveAttribute("data-look", "completed");
  });

  test("an alarm sent while the page was closed appears on opening", async ({ page }) => {
    await stack.triggerAlarm("zone-e");
    const farm = new Farm(page);
    await farm.open();
    await farm.expectLook("zone-e", "alarm");
    await expect(page.getByText("E 구역에 물을 줄 시간이에요")).toBeVisible();
  });

  test("a server restart keeps records, and open pages reconnect", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.stopServer();
    await expect(page.getByText("연결이 끊겼어요")).toBeVisible();

    await stack.startServer();
    await expect(page.getByText("연결이 끊겼어요")).toHaveCount(0, { timeout: 30_000 });
    await page.reload();
    await farm.expectLook("zone-a", "completed");
    await farm.expectLook("zone-e", "alarm");
  });

  test("a lost device shows offline at once and is never sent a command", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.card("zone-e")).toContainText("온라인");
    await stack.stopSimulator();
    await expect(farm.card("zone-e")).toContainText("오프라인", { timeout: 3000 });
    await expect(page.getByText("연결이 끊겼어요")).toHaveCount(0);

    await farm.confirmButton().click();
    await expect(farm.card("zone-e")).toContainText("장비가 오프라인이에요");
    await farm.expectLook("zone-e", "problem");
  });

  test("a pump fault is reported as failed", async ({ page }) => {
    stack.startSimulator({ SIM_INITIAL_SOIL: "30", SIM_PUMP_FAIL_RATE: "1" });
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.card("zone-d")).toContainText("온라인");
    await stack.triggerAlarm("zone-d");
    await farm.confirmButton().click();
    await expect(farm.card("zone-d")).toContainText("펌프 고장");
    await farm.expectLook("zone-d", "problem");
    await stack.stopSimulator();
    stack.startSimulator({ SIM_INITIAL_SOIL: "30" });
  });

  test("an unanswered alarm reminds, then times out without watering", async ({ page }) => {
    await stack.restartServer({ ALARM_REMIND_MIN: "0.03", ALARM_TIMEOUT_MIN: "0.1" });
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-f");
    await expect(page.getByText("다시 알림")).toBeVisible();
    await expect(farm.card("zone-f")).toContainText("시간 초과", { timeout: 15_000 });
    await expect(farm.card("zone-f")).toContainText("물을 주지 않았어요");
    await farm.expectLook("zone-f", "problem");
    await expect(farm.switchInput("zone-f", "vent")).not.toBeChecked();
  });

  test("alarms arrive automatically", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.restartServer({ ALARM_EVERY_MIN: "1" });
    await expect(page.getByText("물을 줄 시간이에요").first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("watering on wet soil", () => {
  const stack = useStack({}, { SIM_INITIAL_SOIL: "80" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("is skipped and never reaches the pump", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.expectLook("zone-a", "wet");

    await farm.plot("zone-a").click({ button: "right" });
    await expect(farm.menuItem(farm.zoneMenu("zone-a"), "물 주기 (토양 수분 충분)")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    await stack.triggerAlarm("zone-a");
    await farm.confirmButton().click();
    await expect(farm.card("zone-a")).toContainText("건너뜀");
    await expect(farm.card("zone-a")).toContainText("토양 수분이 충분해요");
  });
});
