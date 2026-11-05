import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("sections and crops", () => {
  const stack = useStack({ WATERING_DURATION_SEC: "8" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("zones are grouped by crop, each with its own icon in every cell", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(farm.section("bellflower").locator('[data-zone="zone-a"]')).toBeVisible();
    await expect(farm.section("rice").locator('[data-zone="zone-c"]')).toBeVisible();
    await expect(farm.section("lettuce").locator('[data-zone="zone-f"]')).toBeVisible();
    await expect(farm.card("zone-a").locator("[data-cell] svg")).toHaveCount(32);

    const iconOf = (zone: string) => farm.card(zone).locator("[data-cell] svg").first().innerHTML();
    expect(new Set([await iconOf("zone-a"), await iconOf("zone-c"), await iconOf("zone-e")]).size).toBe(3);
  });

  test("water all asks first, then runs the whole section and no other", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator('[data-section-water="lettuce"]').click();
    await expect(page.locator("[data-water-confirm]")).toBeVisible();
    await farm.expectLook("zone-e", "dry");

    await page.locator("[data-water-confirm]").click();
    await farm.expectLook("zone-e", "watering");
    await farm.expectLook("zone-f", "watering");
    await farm.expectLook("zone-d", "dry");

    await page.locator('[data-section-menu="lettuce"]').click();
    await page.locator('[data-section-items="lettuce"]').getByRole("menuitem", { name: "모두 급수 중지" }).click();
    await expect(farm.card("zone-e")).toContainText("중지됨");
    await expect(farm.card("zone-f")).toContainText("중지됨");
  });

  test("section controls switch all of its zones", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    const items = page.locator('[data-section-items="rice"]');
    await page.locator('[data-section-menu="rice"]').click();
    await items.getByRole("menuitem", { name: "환기 모두 켜기" }).click();
    await expect(farm.switchInput("zone-c", "vent")).toBeChecked();
    await expect(farm.switchInput("zone-d", "vent")).toBeChecked();
    await page.locator('[data-section-menu="rice"]').click();
    await items.getByRole("menuitem", { name: "환기 모두 끄기" }).click();
    await expect(farm.switchInput("zone-c", "vent")).not.toBeChecked();
  });

  test("moving a zone changes its crop and survives reloads and restarts", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await farm.plot("zone-f").click({ button: "right" });
    await farm.menuItem(farm.zoneMenu("zone-f"), "벼 섹션으로 이동").click();
    await expect(farm.section("rice").locator('[data-zone="zone-f"]')).toBeVisible();
    await expect(farm.section("lettuce").locator('[data-zone="zone-f"]')).toHaveCount(0);
    await expect(farm.field("zone-f")).toHaveAttribute("data-crop-icon", "wheat");

    await page.reload();
    await expect(farm.section("rice").locator('[data-zone="zone-f"]')).toBeVisible();

    await stack.restartServer();
    await page.reload();
    await expect(farm.section("rice").locator('[data-zone="zone-f"]')).toBeVisible();
  });

  test("adding a crop shows its icon as you type", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator("[data-add-crop]").click();
    const name = page.locator('[name="crop-name"]');
    const preview = page.locator("[data-preview-icon]");

    await name.fill("방울토마토");
    await expect(preview).toHaveAttribute("data-preview-icon", "tomato");
    await expect(page.locator("[data-preview-name]")).toHaveText("방울토마토");

    await name.fill("처음보는작물");
    await expect(preview).toHaveAttribute("data-preview-icon", "sprout");

    await page.locator('[data-icon-option="cherry"]').click();
    await expect(preview).toHaveAttribute("data-preview-icon", "cherry");
    await name.fill("도라지");
    await expect(preview).toHaveAttribute("data-preview-icon", "cherry");

    await page.locator("[data-add-crop-submit]").click();
    await expect(page.getByText("이미 있는 작물이에요")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();

    await page.locator("[data-add-crop]").click();
    await name.fill("옥수수");
    await expect(preview).toHaveAttribute("data-preview-icon", "corn");
    await page.locator("[data-add-crop-submit]").click();

    const section = page.locator("[data-section]", { has: page.getByRole("heading", { name: "옥수수" }) });
    await expect(section.locator("[data-section-icon]")).toHaveAttribute("data-section-icon", "corn");
    await expect(section.locator("[data-section-remove]")).toBeVisible();
    await expect(page.locator('[data-section-remove="bellflower"]')).toHaveCount(0);

    await section.locator("[data-section-remove]").click();
    await expect(section).toHaveCount(0);
  });
});
