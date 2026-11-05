import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("editing sections", () => {
  const stack = useStack({ WATERING_TIMES: "08:00" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  const openMenu = async (farm: Farm, crop: string) => {
    await farm.page.locator(`[data-section-more="${crop}"]`).click();
    return farm.page.locator(`[data-section-more-items="${crop}"]`);
  };
  const order = (farm: Farm) =>
    farm.page
      .locator("[data-section]")
      .evaluateAll((sections) => sections.map((s) => (s as HTMLElement).dataset.section));

  test("renaming keeps the zones and alarm times, and icons follow the choice", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    const menu = await openMenu(farm, "rice");
    await menu.getByRole("menuitem", { name: "이름, 아이콘 수정" }).click();

    const name = page.locator('[name="crop-name"]');
    await expect(name).toHaveValue("벼");
    await expect(page.locator("[data-preview-icon]")).toHaveAttribute("data-preview-icon", "wheat");

    // A rename shouldn't silently swap an icon someone already has.
    await name.fill("옥수수밭");
    await expect(page.locator("[data-preview-icon]")).toHaveAttribute("data-preview-icon", "wheat");
    await page.locator('[data-icon-option="corn"]').click();
    await page.locator("[data-add-crop-submit]").click();

    const section = farm.section("rice");
    await expect(section.locator("h2")).toHaveText("옥수수밭");
    await expect(section.locator("[data-section-icon]")).toHaveAttribute("data-section-icon", "corn");
    await expect(farm.field("zone-c")).toHaveAttribute("data-crop-icon", "corn");
    await expect(section.locator('[data-zone="zone-c"], [data-zone="zone-d"]')).toHaveCount(2);
    await expect(page.locator('[data-section-times="rice"]')).toContainText("08:00");

    await stack.restartServer();
    await page.reload();
    await expect(farm.section("rice").locator("h2")).toHaveText("옥수수밭");
  });

  test("a renamed built-in shows its own name in English, others stay translated", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open("/en");
    await expect(farm.section("rice").locator("h2")).toHaveText("옥수수밭");
    await expect(farm.section("bellflower").locator("h2")).toHaveText("Bellflower");
  });

  test("a duplicate name is refused", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    const menu = await openMenu(farm, "rice");
    await menu.getByRole("menuitem", { name: "이름, 아이콘 수정" }).click();
    await page.locator('[name="crop-name"]').fill("도라지");
    await page.locator("[data-add-crop-submit]").click();
    await expect(page.getByText("이미 있는 작물이에요")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();
    await expect(farm.section("rice").locator("h2")).toHaveText("옥수수밭");
  });

  test("sections move up and down, and the order is kept", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    expect(await order(farm)).toEqual(["bellflower", "rice", "lettuce"]);

    let menu = await openMenu(farm, "bellflower");
    await expect(menu.getByRole("menuitem", { name: "위로" })).toHaveAttribute("aria-disabled", "true");
    await menu.getByRole("menuitem", { name: "아래로" }).click();
    await expect.poll(() => order(farm)).toEqual(["rice", "bellflower", "lettuce"]);

    menu = await openMenu(farm, "lettuce");
    await expect(menu.getByRole("menuitem", { name: "아래로" })).toHaveAttribute("aria-disabled", "true");
    await menu.getByRole("menuitem", { name: "위로" }).click();
    await expect.poll(() => order(farm)).toEqual(["rice", "lettuce", "bellflower"]);

    await page.reload();
    await expect.poll(() => order(farm)).toEqual(["rice", "lettuce", "bellflower"]);
  });

  test("edits appear in the control history", async ({ page }) => {
    await page.goto("/ko/history");
    const edits = page.locator('[data-history-row="crop_edit"]');
    await expect(edits.and(page.locator('[data-result="ok"]')).first()).toContainText("벼 → 옥수수밭");
    await expect(edits.and(page.locator('[data-result="duplicate"]')).first()).toContainText("옥수수밭 → 도라지");
    await expect(page.locator('[data-history-row="crops_reorder"]').first()).toContainText("섹션 순서 변경");
  });
});
