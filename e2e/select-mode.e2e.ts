import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("selecting without a mouse", () => {
  useStack({ WATERING_DURATION_SEC: "20" }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  const box = (farm: Farm, zone: string) => farm.page.locator(`[data-select-zone="${zone}"]`);

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("selection mode lets you tap fields and act on them together", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await expect(box(farm, "zone-a")).toHaveCount(0);

      await page.locator("[data-select-mode]").tap();
      await box(farm, "zone-a").tap();
      await box(farm, "zone-b").tap();
      await expect(page.locator("[data-selection-count]")).toContainText("2");
      await box(farm, "zone-b").tap();
      await expect(page.locator("[data-selection-count]")).toContainText("1");
      await box(farm, "zone-b").tap();

      await page.locator("[data-selection-water]").tap();
      await page.locator("[data-water-confirm]").tap();
      await farm.expectLook("zone-a", "watering");
      await farm.expectLook("zone-b", "watering");

      await page.locator("[data-selection-control]").tap();
      await page.locator("[data-selection-control-items]").getByRole("menuitem", { name: "모두 급수 중지" }).tap();
      await expect(farm.card("zone-a")).toContainText("중지됨");
      await expect(farm.card("zone-b")).toContainText("중지됨");

      const { inner, width } = await page.evaluate(() => ({
        inner: innerWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(width).toBe(inner);

      await page.locator("[data-select-mode]").tap();
      await expect(box(farm, "zone-a")).toHaveCount(0);
      await expect(page.locator("[data-selection-count]")).toHaveCount(0);
    });

    test("dragging a finger across fields never selects them, and scrolling isn't blocked", async ({
      page,
      context,
    }) => {
      const farm = new Farm(page);
      await farm.open();
      await page.evaluate(() => {
        (window as any).__pointers = [];
        document.addEventListener("pointerdown", (event) => (window as any).__pointers.push(event.pointerType));
      });

      const card = (await farm.card("zone-a").boundingBox())!;
      const point = (y: number) => ({ x: card.x + card.width / 2, y });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(card.y + 300)] });
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [point(card.y + 300 - step * 40)],
        });
      }
      await expect(page.locator("[data-marquee]")).toHaveCount(0);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

      // Proves the gesture reached the page as touch, so "nothing selected" means something.
      expect(await page.evaluate(() => (window as any).__pointers)).toContain("touch");
      await expect(page.locator("[data-selected]")).toHaveCount(0);
      await expect(page.locator("[data-selection-count]")).toHaveCount(0);
      await expect(farm.card("zone-a")).not.toHaveCSS("touch-action", "none");
    });
  });

  test("the keyboard can do it all", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator("[data-select-mode]").focus();
    await page.keyboard.press("Enter");

    await expect(box(farm, "zone-a")).toBeVisible();
    await box(farm, "zone-a").locator("input").focus();
    await page.keyboard.press("Space");
    await box(farm, "zone-c").locator("input").focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-selection-count]")).toContainText("2");

    await page.locator("[data-selection-move]").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-selection-move-items]")).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(farm.section("lettuce").locator('[data-zone="zone-a"], [data-zone="zone-c"]')).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-selected]")).toHaveCount(0);
  });

  test("mouse selection and checkboxes agree", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator("[data-select-mode]").click();
    const card = (await farm.card("zone-b").boundingBox())!;
    await page.mouse.click(card.x + 40, card.y + 130);
    await expect(box(farm, "zone-b").locator("input")).toBeChecked();
    await box(farm, "zone-b").click();
    await expect(page.locator("[data-selected]")).toHaveCount(0);
  });

  test("a viewer has no selection mode", async ({ browser, context }) => {
    await signIn(context);
    const { createUser } = await import("./fixtures");
    await createUser(context, {
      name: "이조회",
      email: "viewer@terranova.test",
      password: "correct-horse-2",
      role: "viewer",
    });
    const viewer = await browser.newContext({ baseURL: "http://localhost:3000" });
    await signIn(viewer, "viewer@terranova.test", "correct-horse-2");
    const page = await viewer.newPage();
    await new Farm(page).open();
    await expect(page.locator("[data-select-mode]")).toHaveCount(0);
    await viewer.close();
  });
});
