import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("skip link", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);

  const skipsToMain = async (page: import("@playwright/test").Page, name: string) => {
    // These tests run on `next dev`, whose tools can take the first Tab, so check the order directly.
    const link = page.getByRole("link", { name });
    const first = await page.evaluate(
      () => document.querySelector("a[href], button, input, select, textarea, [tabindex='0']")?.textContent,
    );
    expect(first).toBe(name);
    await link.focus();
    await expect(link).toBeInViewport();
    await page.keyboard.press("Enter");
    const main = page.locator("main#main");
    await expect(main).toBeFocused();
    await expect(main).not.toHaveCSS("outline-style", "none");
  };

  test("the sign-in page has one", async ({ page }) => {
    await page.goto("/ko/login");
    await expect(page.locator("main")).toBeVisible();
    await skipsToMain(page, "본문 바로가기");
  });

  test("the dashboard skips past the navigation", async ({ page, context }) => {
    await signIn(context);
    await new Farm(page).open();
    await page.reload();
    await skipsToMain(page, "본문 바로가기");
  });

  test("the not-found page has one, and it follows the language", async ({ page, context }) => {
    await signIn(context);
    await page.goto("/en/no-such-page");
    await expect(page.locator("main")).toBeVisible();
    await skipsToMain(page, "Skip to main content");
  });
});
