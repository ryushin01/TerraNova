import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("several alarms at once", () => {
  const stack = useStack({ WATERING_DURATION_SEC: "20" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("they collapse into one line, which can confirm them all", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-a");
    await expect(page.getByRole("button", { name: "확인하고 물 주기", exact: true })).toBeVisible();
    await expect(page.locator("[data-confirm-all]")).toHaveCount(0);

    await stack.triggerAlarm("zone-c");
    await stack.triggerAlarm("zone-e");
    await expect(page.locator("[data-alarm-summary]")).toContainText("A, C, E 구역");
    await expect(page.getByRole("button", { name: "확인하고 물 주기", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "개별 보기" }).click();
    await expect(page.getByRole("button", { name: "확인하고 물 주기", exact: true })).toHaveCount(3);
    await page.getByRole("button", { name: "접기" }).click();
    await expect(page.getByRole("button", { name: "확인하고 물 주기", exact: true })).toHaveCount(0);

    await page.locator("[data-confirm-all]").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("3개 알람");
    await farm.expectLook("zone-a", "alarm");

    await page.locator("[data-water-confirm]").click();
    await farm.expectLook("zone-a", "watering");
    await farm.expectLook("zone-c", "watering");
    await farm.expectLook("zone-e", "watering");
    await farm.expectLook("zone-b", "dry");
    await expect(page.getByText("3개 구역 시작")).toBeVisible();

    for (const zone of ["zone-a", "zone-c", "zone-e"]) {
      await page.locator(`[data-stop="${zone}"]`).click();
      await expect(farm.card(zone)).toContainText("중지됨");
    }

    await page.goto("/ko/history");
    await page.locator('[name="history-action"]').selectOption("alarm_confirm");
    await expect(page.locator("[data-history-row]")).toHaveCount(3);
  });

  test("individual confirmation still works from the expanded list", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-b");
    await stack.triggerAlarm("zone-d");
    await page.getByRole("button", { name: "개별 보기" }).click();
    await page.getByRole("button", { name: "확인하고 물 주기", exact: true }).first().click();
    await farm.expectLook("zone-b", "watering");
    await farm.expectLook("zone-d", "alarm");
    await expect(page.locator("[data-confirm-all]")).toHaveCount(0);
    await page.locator('[data-stop="zone-b"]').click();
    await expect(farm.card("zone-b")).toContainText("중지됨");
  });
});
