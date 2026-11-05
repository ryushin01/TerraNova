import { createAdmin, expect, Farm, signIn, test, useStack } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.describe("choosing a language", () => {
  useStack();

  test.beforeAll(createAdmin);

  for (const { browser, language } of [
    { browser: "en-US", language: "en" },
    { browser: "ko-KR", language: "ko" },
    { browser: "fr-FR", language: "ko" },
  ]) {
    test.describe(`a first visit from a ${browser} browser`, () => {
      test.use({ locale: browser });

      test(`opens in ${language}`, async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL(new RegExp(`/${language}/login$`));
        await expect(page.locator("html")).toHaveAttribute("lang", language);
      });
    });
  }

  test.describe("after choosing one", () => {
    test.use({ locale: "ko-KR" });

    test("the choice beats the browser's language on the next visit", async ({ context, page }) => {
      await signIn(context);
      const farm = new Farm(page);
      await farm.open();
      await page.getByRole("link", { name: "English" }).click();
      await expect(page).toHaveURL(/\/en\/?$/);

      await page.goto("/");
      await expect(page).toHaveURL(/\/en\/?$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });

  test.describe("the crop icon picker", () => {
    test.beforeEach(({ context }) => signIn(context));

    for (const { path, addCrop, tomato } of [
      { path: "/ko", addCrop: "작물 추가", tomato: "토마토" },
      { path: "/en", addCrop: "Add crop", tomato: "Tomato" },
    ]) {
      test(`names its icons at ${path}`, async ({ page }) => {
        const farm = new Farm(page);
        await farm.open(path);
        await page.getByRole("button", { name: addCrop }).click();
        await expect(page.locator('[data-icon-option="tomato"]')).toHaveAttribute("aria-label", tomato);
      });
    }
  });
});
