import { Farm, createAdmin, expect, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("field menu", () => {
  useStack({ WATERING_DURATION_SEC: "4" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("right click waters for real and reports completion", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.plot("zone-c").click({ button: "right" });
    const menu = farm.zoneMenu("zone-c");
    await expect(farm.menuItem(menu, "환기 켜기")).toBeVisible();
    await expect(farm.menuItem(menu, "조명 켜기")).toBeVisible();
    await farm.menuItem(menu, "물 주기").click();

    await farm.expectLook("zone-c", "watering");
    await expect(farm.card("zone-c")).toContainText("켜짐");

    await farm.plot("zone-c").click({ button: "right" });
    await expect(farm.menuItem(menu, "물 주기")).toHaveAttribute("aria-disabled", "true");
    await expect(farm.menuItem(menu, "급수 중지")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(farm.card("zone-c")).toContainText("물주기 완료");
    await farm.expectLook("zone-c", "completed");
    await expect(page.getByText("C 구역 물주기 완료")).toBeVisible();
  });

  test("the three-dot button opens the same menu", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator('[data-menu-button="zone-d"]').click();
    await farm.menuItem(farm.zoneMenu("zone-d"), "조명 켜기").click();
    await expect(farm.switchInput("zone-d", "light")).toBeChecked();
    await page.locator('[data-menu-button="zone-d"]').click();
    await farm.menuItem(farm.zoneMenu("zone-d"), "조명 끄기").click();
    await expect(farm.switchInput("zone-d", "light")).not.toBeChecked();
  });

  test("switches follow what the device reports", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.switchInput("zone-b", "vent")).not.toBeChecked();
    await farm.toggle("zone-b", "vent");
    await expect(farm.switchInput("zone-b", "vent")).toBeChecked();
    await farm.toggle("zone-b", "light");
    await expect(farm.switchInput("zone-b", "light")).toBeChecked();
    await farm.toggle("zone-b", "vent");
    await expect(farm.switchInput("zone-b", "vent")).not.toBeChecked();
    await farm.toggle("zone-b", "light");
    await expect(farm.switchInput("zone-b", "light")).not.toBeChecked();
  });
});

test.describe("field menu on a touch screen", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("a long press opens the menu", async ({ page, context }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.plot("zone-a").scrollIntoViewIfNeeded();
    const box = (await farm.plot("zone-a").boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(900);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(farm.menuItem(farm.zoneMenu("zone-a"), "물 주기")).toBeVisible();
  });
});
