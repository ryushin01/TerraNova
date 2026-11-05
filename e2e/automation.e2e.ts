import { Farm, createAdmin, expect, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("automatic control", () => {
  const stack = useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  const openRules = async (farm: Farm, crop: string) => {
    await farm.page.locator(`[data-section-more="${crop}"]`).click();
    await farm.page.locator(`[data-section-more-items="${crop}"]`).getByRole("menuitem", { name: "자동 제어" }).click();
    await expect(farm.page.locator('[name="vent-on"]')).toBeVisible();
  };
  const save = (farm: Farm) => farm.page.locator("[data-automation-save]").click();

  test("incomplete or contradictory rules are refused with a reason", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openRules(farm, "rice");
    await page.locator('[name="vent-on"]').fill("20");
    await save(farm);
    await expect(page.locator("[data-automation-error]")).toBeVisible();
    await page.locator('[name="vent-off"]').fill("25");
    await save(farm);
    await expect(page.locator("[data-automation-error]")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();
    await expect(page.locator('[data-section-auto="rice"]')).toHaveCount(0);
  });

  test("a temperature rule turns ventilation on with no one touching it, and says who did it", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.switchInput("zone-c", "vent")).not.toBeChecked();
    await openRules(farm, "rice");
    await page.locator('[name="vent-on"]').fill("10");
    await page.locator('[name="vent-off"]').fill("5");
    await save(farm);

    await expect(page.locator('[data-section-auto="rice"]')).toBeVisible();
    await expect(farm.switchInput("zone-c", "vent")).toBeChecked();
    await expect(farm.switchInput("zone-d", "vent")).toBeChecked();
    await expect(farm.switchInput("zone-a", "vent")).not.toBeChecked();

    await page.goto("/ko/history");
    await page.locator('[name="history-action"]').selectOption("actuator_set");
    await expect(page.locator("[data-history-row]").first()).toContainText("자동 제어");
    await page.locator('[name="history-action"]').selectOption("automation_change");
    await expect(page.locator("[data-history-row]").first()).toContainText("벼");
  });

  test("switching by hand holds the rule, so it doesn't fight the person", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.switchInput("zone-c", "vent")).toBeChecked();
    await farm.toggle("zone-c", "vent");
    await expect(farm.switchInput("zone-c", "vent")).not.toBeChecked();
    await page.waitForTimeout(5000);
    await expect(farm.switchInput("zone-c", "vent")).not.toBeChecked();
    await expect(farm.switchInput("zone-d", "vent")).toBeChecked();
  });

  test("a light window turns lighting on, and saved rules come back into the form", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openRules(farm, "bellflower");
    await page.locator('[name="light-on"]').fill("00:00");
    await page.locator('[name="light-off"]').fill("23:59");
    await save(farm);
    await expect(farm.switchInput("zone-a", "light")).toBeChecked();

    await stack.restartServer();
    await page.reload();
    await openRules(farm, "bellflower");
    await expect(page.locator('[name="light-on"]')).toHaveValue("00:00");
    await expect(page.locator('[name="light-off"]')).toHaveValue("23:59");
  });

  test("dry soil raises an alarm for that section, and nothing waters until someone confirms", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.expectLook("zone-e", "dry");
    await openRules(farm, "lettuce");
    await page.locator('[name="soil-alarm"]').fill("50");
    await save(farm);

    await farm.expectLook("zone-e", "alarm");
    await farm.expectLook("zone-f", "alarm");
    await page.waitForTimeout(4000);
    await farm.expectLook("zone-e", "alarm");
    await expect(farm.card("zone-e")).not.toContainText("켜짐");

    await page.locator("[data-confirm-all]").click();
    await page.locator("[data-water-confirm]").click();
    await farm.expectLook("zone-e", "watering");
    await page.locator('[data-stop="zone-e"]').click();
    await page.locator('[data-stop="zone-f"]').click();
    await expect(farm.card("zone-e")).toContainText("중지됨");
    await expect(farm.card("zone-f")).toContainText("중지됨");
  });

  test("clearing the fields turns the rules off", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openRules(farm, "rice");
    await page.locator('[name="vent-on"]').fill("");
    await page.locator('[name="vent-off"]').fill("");
    await save(farm);
    await expect(page.locator('[data-section-auto="rice"]')).toHaveCount(0);
  });
});
