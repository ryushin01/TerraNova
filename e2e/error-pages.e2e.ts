import { createAdmin, expect, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("not-found page", () => {
  useStack();

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  test("an unknown path shows the 404 screen in the current language and links home", async ({ page }) => {
    const response = await page.goto("/ko/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
    await expect(page).toHaveTitle("페이지를 찾을 수 없어요");
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    await page.getByRole("link", { name: "대시보드로 가기" }).click();
    await expect(page).toHaveURL(/\/ko\/?$/);
  });

  test("the 404 screen follows the English locale", async ({ page }) => {
    await page.goto("/en/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
