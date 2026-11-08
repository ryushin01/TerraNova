import type { Page } from "@playwright/test";
import { createAdmin, expect, expectFitsScreen, Farm, signIn, test, useStack } from "./fixtures";
import { WEB_PORT } from "./ports";

test.describe.configure({ mode: "serial" });

test.describe("screen sizes and languages", () => {
  const stack = useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("every page fits and the grid is one column", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await expectFitsScreen(page);
      const columns = await page
        .locator("ul")
        .first()
        .evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(1);
      await page.goto("/ko/users");
      await expect(page.locator("[data-user]").first()).toBeVisible();
      await expectFitsScreen(page);
    });
    test("the header fits, and language and theme are in the menu", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      const open = page.getByRole("button", { name: "메뉴 열기" });
      await expect(open).toBeInViewport({ ratio: 1 });

      await open.tap();
      const drawer = page.getByRole("dialog");
      // The drawer stays dark in either theme, so a theme-colored focus ring would vanish on it.
      const themeButton = drawer.getByRole("button", { name: "다크 모드" });
      await themeButton.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(themeButton).toBeFocused();
      await expect(themeButton).toHaveCSS("outline-color", "rgb(242, 242, 242)");
      await drawer.getByRole("button", { name: "다크 모드" }).tap();
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(drawer.getByRole("button", { name: "라이트 모드" })).toBeVisible();
      await drawer.getByRole("button", { name: "라이트 모드" }).tap();
      await expect(page.locator("html")).toHaveClass(/light/);

      await drawer.getByRole("link", { name: "English" }).tap();
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });

    test("nothing runs off the narrowest common screen", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const farm = new Farm(page);
      await farm.open();
      await expectFitsScreen(page);
      await expect(page.getByRole("button", { name: "메뉴 열기" })).toBeInViewport({ ratio: 1 });
    });
  });

  test.describe("on a tablet", () => {
    test.use({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true });

    test("the field is a two-column grid in English", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open("/en");
      await expect(page.getByText("Soil moisture").first()).toBeVisible();
      const columns = await page
        .locator("ul")
        .first()
        .evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(2);
      await expectFitsScreen(page);
    });
  });

  test.describe("the dashboard's panels", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

    test("the overview has one row, and the crops fill the rows below it", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await expect(page.getByRole("heading", { level: 1, name: "구역 현황" })).toBeVisible();

      const map = page.locator("[data-zone-map]");
      await expect(map).toHaveAttribute("aria-label", /A 구역 .+, F 구역 /);
      await expect(page.locator("[data-map-tile]")).toHaveCount(6);
      expect((await box(page, "[data-zone-map]")).y).toBeLessThan((await box(page, "[data-section]")).y);

      // Two crops of two zones share a row, and the third takes the whole next one.
      const [first, second, third] = await Promise.all(
        [0, 1, 2].map(async (index) => (await page.locator("[data-section]").nth(index).boundingBox())!),
      );
      expect(second!.y).toBe(first!.y);
      expect(third!.y).toBeGreaterThan(first!.y);
      expect(Math.round(third!.width)).toBe(Math.round(second!.x + second!.width - first!.x));
      await expectFitsScreen(page);
    });

    test("the map shows a zone's state, and the current page stands out in the menu", async ({ page }) => {
      const farm = new Farm(page);
      await farm.open();
      await stack.triggerAlarm("zone-b");
      await expect(page.locator('[data-map-tile="zone-b"]')).toHaveAttribute("data-map-look", "alarm");
      await expect(page.locator("[data-zone-map]")).toHaveAttribute("aria-label", /B 구역 알람 발송/);

      const current = farm.navLink("구역 현황");
      await expect(current).toHaveAttribute("aria-current", "page");
      await expect(current).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(farm.navLink("센서 이력")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    });
  });

  test("loading shows no false disconnect or offline flash", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__flash = new Set<string>();
      addEventListener("DOMContentLoaded", () => {
        const check = () => {
          if (document.body.innerText.includes("연결이 끊겼어요")) (window as any).__flash.add("disconnected");
          // Only the cards: the color legend always contains the word.
          for (const card of document.querySelectorAll<HTMLElement>("[data-zone]")) {
            if (card.innerText.includes("오프라인")) (window as any).__flash.add(`offline:${card.dataset.zone}`);
          }
        };
        check();
        new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    });
    await new Farm(page).open();
    expect(await page.evaluate(() => [...(window as any).__flash])).toEqual([]);
  });

  test("reduced motion stops the field animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const farm = new Farm(page);
    await farm.open();
    await stack.triggerAlarm("zone-a");
    await farm.expectLook("zone-a", "alarm");
    await expect(farm.firstCell("zone-a")).toHaveCSS("animation-name", "none");
  });
});

test("the web server only listens on this computer", async () => {
  const { networkInterfaces } = await import("node:os");
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((address) => address && address.family === "IPv4" && !address.internal)?.address;
  test.skip(!lan, "no network interface");
  await expect(fetch(`http://${lan}:${WEB_PORT}/ko/login`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
});
