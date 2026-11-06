import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("account changes and appearance", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("adding, changing and removing an account are recorded, and passwords aren't", async ({ page }) => {
    await page.goto("/ko/users");
    await page.locator('[name="name"]').fill("김작업");
    await page.locator('[name="email"]').fill("kim@terranova.test");
    await page.locator('[name="password"]').fill("correct-horse-2");
    await page.getByRole("button", { name: "추가", exact: true }).click();
    const row = page.locator('[data-user="kim@terranova.test"]');
    await expect(row).toBeVisible();

    await row.getByRole("combobox").selectOption("operator");
    await expect(page.getByText("역할을 변경했어요")).toBeVisible();

    await row.getByRole("button", { name: "삭제" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "삭제" }).click();
    await expect(row).toHaveCount(0);

    await page.goto("/ko/history");
    await expect(page.locator('[data-history-row="account_create"]')).toContainText("김작업");
    await expect(page.locator('[data-history-row="role_change"]')).toContainText("작업자");
    // Recorded by name even though the account no longer exists.
    await expect(page.locator('[data-history-row="account_remove"]')).toContainText("김작업");
    await expect(page.locator("main")).not.toContainText("correct-horse-2");
  });

  test("a held setting can be handed back to the rule", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator('[data-section-more="rice"]').click();
    await page.locator('[data-section-more-items="rice"]').getByRole("menuitem", { name: "자동 제어" }).click();
    await page.locator('[name="humidity-on"]').fill("5");
    await page.locator('[name="humidity-off"]').fill("1");
    await page.locator("[data-automation-save]").click();

    await expect(farm.switchInput("zone-c", "vent")).toBeChecked();
    await farm.toggle("zone-c", "vent");
    await expect(farm.switchInput("zone-c", "vent")).not.toBeChecked();
    await expect(farm.card("zone-c").locator("[data-automation-paused]")).toBeVisible();

    await farm.card("zone-c").locator('[data-automation-resume="vent"]').click();
    await expect(farm.card("zone-c").locator("[data-automation-paused]")).toHaveCount(0);
    await expect(farm.switchInput("zone-c", "vent")).toBeChecked({ timeout: 70_000 });
  });

  test("dark mode can be switched on, is kept, and every page renders", async ({ page }) => {
    test.setTimeout(90_000);
    const farm = new Farm(page);
    await farm.open();
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await background();

    await page.getByRole("button", { name: "다크 모드" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect.poll(background).not.toBe(light);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);

    for (const path of ["/ko/sensors", "/ko/history", "/ko/users", "/ko"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
    }
    await page.getByRole("button", { name: "라이트 모드" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("the app can be installed", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    expect((await response.json()).name).toBe("TerraNova");
    expect((await request.get("/app-icon.svg")).ok()).toBe(true);
  });
});
