import type { Page } from "@playwright/test";
import { Farm, createAdmin, expect, signIn, test, useStack } from "./fixtures";

const selected = (page: Page) =>
  page.locator("[data-selected]").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.zone).sort().join());

const box = async (farm: Farm, zone: string) => (await farm.card(zone).boundingBox())!;

async function drawBox(farm: Farm, from: string, to: string, release = true) {
  const a = await box(farm, from);
  const b = await box(farm, to);
  const { mouse } = farm.page;
  await mouse.move(a.x - 14, a.y - 10);
  await mouse.down();
  await mouse.move(b.x + b.width - 20, b.y + b.height - 20, { steps: 8 });
  if (release) await mouse.up();
}

async function clickCard(farm: Farm, zone: string) {
  const card = await box(farm, zone);
  await farm.page.mouse.click(card.x + 50, card.y + 120);
}

test.describe.configure({ mode: "serial" });

test.describe("drag selection", () => {
  useStack({ WATERING_DURATION_SEC: "8" }, { SIM_INITIAL_SOIL: "30" });

  test.use({ viewport: { width: 1280, height: 3400 } });
  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("a box selects the fields inside it, without selecting text", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await drawBox(farm, "zone-a", "zone-b", false);
    await expect(page.locator("[data-marquee]")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => selected(page)).toBe("zone-a,zone-b");
    await expect(page.locator("[data-marquee]")).toHaveCount(0);
    await expect(page.locator("[data-selection-count]")).toContainText("2");
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("");

    await page.keyboard.press("Escape");
    await expect.poll(() => selected(page)).toBe("");
  });

  test("click, Cmd-click and Shift-drag adjust the selection", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await clickCard(farm, "zone-c");
    await expect.poll(() => selected(page)).toBe("zone-c");

    await page.keyboard.down("Meta");
    await clickCard(farm, "zone-d");
    await expect.poll(() => selected(page)).toBe("zone-c,zone-d");
    await clickCard(farm, "zone-d");
    await expect.poll(() => selected(page)).toBe("zone-c");
    await page.keyboard.up("Meta");

    await page.keyboard.down("Shift");
    await drawBox(farm, "zone-a", "zone-b");
    await page.keyboard.up("Shift");
    await expect.poll(() => selected(page)).toBe("zone-a,zone-b,zone-c");
  });

  test("dragging from a switch doesn't start a selection", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    const control = (await farm.switchOf("zone-a", "vent").locator('[data-part="control"]').boundingBox())!;
    await page.mouse.move(control.x + 10, control.y + 10);
    await page.mouse.down();
    await page.mouse.move(control.x + 210, control.y + 70, { steps: 5 });
    await page.mouse.up();
    expect(await selected(page)).toBe("");
  });

  test("selected fields can be dragged to another section together", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await drawBox(farm, "zone-a", "zone-b");
    await expect.poll(() => selected(page)).toBe("zone-a,zone-b");

    const card = await box(farm, "zone-a");
    const target = (await farm.section("lettuce").boundingBox())!;
    const dropX = target.x + target.width / 2;
    const dropY = target.y + target.height / 2;
    await page.mouse.move(card.x + 60, card.y + 120);
    await page.mouse.down();
    await page.mouse.move(dropX, dropY, { steps: 10 });
    await expect(page.locator("[data-drag-ghost]")).toContainText("2");
    await expect(farm.section("lettuce")).toHaveAttribute("data-drop-target", "true");
    await page.mouse.up();

    await expect(farm.section("lettuce").locator('[data-zone="zone-a"], [data-zone="zone-b"]')).toHaveCount(2);
    await expect(farm.field("zone-a")).toHaveAttribute("data-crop-icon", "leaf");
    await expect(farm.field("zone-b")).toHaveAttribute("data-crop-icon", "leaf");
    await expect(page.locator("[data-drag-ghost]")).toHaveCount(0);
  });

  test("the bar waters, stops, switches and moves the selection", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await clickCard(farm, "zone-a");
    await page.keyboard.down("Meta");
    await clickCard(farm, "zone-b");
    await page.keyboard.up("Meta");
    await expect.poll(() => selected(page)).toBe("zone-a,zone-b");

    await page.locator("[data-selection-water]").click();
    await expect(page.locator("[data-water-confirm]")).toBeVisible();
    await page.locator("[data-water-confirm]").click();
    await farm.expectLook("zone-a", "watering");
    await farm.expectLook("zone-b", "watering");

    const control = page.locator("[data-selection-control-items]");
    await page.locator("[data-selection-control]").click();
    await control.getByRole("menuitem", { name: "모두 급수 중지" }).click();
    await expect(farm.card("zone-a")).toContainText("중지됨");
    await expect(farm.card("zone-b")).toContainText("중지됨");

    await farm.plot("zone-a").click({ button: "right" });
    const context = farm.zoneMenu("zone-a");
    await expect(context).toContainText("2개 구역 선택");
    await context.getByRole("menuitem", { name: "조명 모두 켜기" }).click();
    await expect(farm.switchInput("zone-a", "light")).toBeChecked();
    await expect(farm.switchInput("zone-b", "light")).toBeChecked();

    await page.locator("[data-selection-move]").click();
    await page.locator("[data-selection-move-items]").getByRole("menuitem", { name: /도라지/ }).click();
    await expect(farm.section("bellflower").locator('[data-zone="zone-a"], [data-zone="zone-b"]')).toHaveCount(2);
  });
});

test.describe("dragging on a short screen", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.use({ viewport: { width: 1280, height: 700 } });
  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("the page scrolls at the edge, and Esc cancels without moving anything", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await clickCard(farm, "zone-a");
    await expect.poll(() => selected(page)).toBe("zone-a");

    const card = await box(farm, "zone-a");
    await page.mouse.move(card.x + 60, Math.min(card.y + 120, 600));
    await page.mouse.down();
    await page.mouse.move(640, 680, { steps: 6 });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);

    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("[data-drag-ghost]")).toHaveCount(0);
    await expect(farm.section("bellflower").locator('[data-zone="zone-a"]')).toBeVisible();
  });
});
