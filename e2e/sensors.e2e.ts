import { createAdmin, createUser, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("sensor history", () => {
  useStack({ SENSOR_SAMPLE_SEC: "1" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("readings become one chart per measure, reached from the menu", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.waitForTimeout(3000);
    const menu = await farm.openAccountMenu();
    await menu.getByRole("menuitem", { name: "센서 이력" }).click();
    await expect(page).toHaveURL(/\/ko\/sensors$/);

    for (const measure of ["temperatureC", "humidityPct", "soilMoisturePct"]) {
      const chart = page.locator(`[data-sensor-chart="${measure}"]`);
      // One reading so far: with no line to draw yet, it must still show as a marker.
      await expect(chart.locator("svg circle").first()).toBeVisible();
      await expect(chart.locator("[data-sensor-latest]")).toHaveText(/\d/);
      await expect(chart.locator('[role="img"]')).toHaveAttribute("aria-label", /\d/);
    }
    // Different scales never share a chart.
    await expect(page.locator(".recharts-yAxis")).toHaveCount(3);
  });

  test("hovering a reading shows its value and time", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/ko/sensors");
    await page.locator('[name="sensor-zone"]').selectOption("zone-a");
    await page.getByText("1시간", { exact: true }).click();
    const chart = page.locator('[data-sensor-chart="soilMoisturePct"]');
    await expect(chart.locator("[data-sensor-latest]")).toHaveText(/\d/);
    const plot = (await chart.locator("svg.recharts-surface").boundingBox())!;
    // The newest bucket can be empty for a moment just after the minute turns.
    await expect(async () => {
      await page.mouse.move(plot.x + plot.width - 30, plot.y + 40);
      await page.mouse.move(plot.x + plot.width - 10, plot.y + 50);
      await expect(chart.locator("[data-sensor-tooltip]")).toContainText("%", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  });

  test("the table view holds the same readings, and ranges and zones switch", async ({ page }) => {
    await page.goto("/ko/sensors");
    await expect(page.locator('[data-sensor-chart="temperatureC"]')).toBeVisible();
    await page.locator("[data-sensor-table-toggle]").click();
    await expect(page.locator("[data-sensor-row]").first()).toBeVisible();

    for (const label of ["1시간", "7일", "30일", "24시간"]) {
      await page.getByText(label, { exact: true }).click();
      await expect(page.locator("[data-sensor-row]").first()).toBeVisible();
    }
    await page.locator('[name="sensor-zone"]').selectOption("zone-f");
    await expect(page.locator("[data-sensor-row]").first()).toBeVisible();
  });

  test("a new reading appears as time passes", async ({ page }) => {
    test.setTimeout(100_000);
    await page.goto("/ko/sensors");
    await page.getByText("1시간", { exact: true }).click();
    await page.locator("[data-sensor-table-toggle]").click();
    await expect(page.locator("[data-sensor-row]").first()).toBeVisible();
    const before = await page.locator("[data-sensor-row]").count();
    await expect
      .poll(() => page.locator("[data-sensor-row]").count(), { timeout: 95_000, intervals: [2000] })
      .toBeGreaterThan(before);
  });

  test("anyone signed in can read it; others and bad requests can't", async ({ browser, context, request }) => {
    await createUser(context, {
      name: "이조회",
      email: "viewer@terranova.test",
      password: "correct-horse-2",
      role: "viewer",
    });
    const viewer = await browser.newContext({ baseURL: "http://localhost:3000" });
    await signIn(viewer, "viewer@terranova.test", "correct-horse-2");
    expect((await viewer.request.get("/api/sensors?zone=zone-a&range=1h")).status()).toBe(200);
    expect((await viewer.request.get("/api/sensors?zone=nope&range=1h")).status()).toBe(400);
    expect((await viewer.request.get("/api/sensors?zone=zone-a&range=1y")).status()).toBe(400);
    expect((await viewer.request.get("/api/sensors")).status()).toBe(400);
    await viewer.close();
    expect((await request.get("/api/sensors?zone=zone-a&range=1h")).status()).toBe(401);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("fits the screen", async ({ page }) => {
      await page.goto("/ko/sensors");
      await expect(page.locator('[data-sensor-chart="temperatureC"]')).toBeVisible();
      const { inner, width } = await page.evaluate(() => ({
        inner: innerWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(width).toBe(inner);
    });
  });
});
