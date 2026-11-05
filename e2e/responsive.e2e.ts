import type { Page } from "@playwright/test";
import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

const expectNoSideScroll = async (page: Page) => {
  const { inner, scroll } = await page.evaluate(() => ({
    inner: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(scroll).toBe(inner);
};

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
      await expectNoSideScroll(page);
      const columns = await page
        .locator("ul")
        .first()
        .evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(1);
      await page.goto("/ko/users");
      await expect(page.locator("[data-user]").first()).toBeVisible();
      await expectNoSideScroll(page);
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
      await expectNoSideScroll(page);
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
  await expect(fetch(`http://${lan}:3000/ko/login`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
});
