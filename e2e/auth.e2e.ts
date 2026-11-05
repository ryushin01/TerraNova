import { ADMIN, createUser, expect, Farm, signIn, test, useStack } from "./fixtures";

const VIEWER = { name: "조회자", email: "viewer@terranova.test", password: "correct-horse-2", role: "viewer" };

test.describe.configure({ mode: "serial" });

test.describe("accounts", () => {
  const stack = useStack({}, { SIM_INITIAL_SOIL: "30" });

  test("a new install leads to setup, which signs the first admin in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ko\/setup$/);
    await page.locator('[name="name"]').fill(ADMIN.name);
    await page.locator('[name="email"]').fill(ADMIN.email);
    await page.locator('[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: "관리자 만들기" }).click();
    await expect(page).toHaveURL(/\/ko$/);
    await expect(new Farm(page).card("zone-a")).toBeVisible();
  });

  test("setup cannot run twice and other origins are refused", async ({ request }) => {
    const data = { name: "X", email: "x@terranova.test", password: "correct-horse-9" };
    const again = await request.post("/api/setup", { headers: { origin: "http://localhost:3000" }, data });
    expect(again.status()).toBe(409);
    const noOrigin = await fetch("http://127.0.0.1:4000/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    expect(noOrigin.status).toBe(403);
  });

  test("signed-out visitors are sent to login", async ({ page }) => {
    await page.goto("/ko");
    await expect(page).toHaveURL(/\/ko\/login$/);
    await page.goto("/ko/users");
    await expect(page).toHaveURL(/\/ko\/login$/);
  });

  test("a wrong password shows a message and stays out of the URL", async ({ page }) => {
    await page.goto("/ko/login");
    await page.locator('[name="email"]').fill(ADMIN.email);
    await page.locator('[name="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page.getByText("맞지 않아요")).toBeVisible();
    expect(page.url()).not.toContain("wrong-password");
  });

  test("the login button waits until the page is interactive", async ({ page }) => {
    await page.route("**/_next/static/**/*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.goto("/ko/login", { waitUntil: "commit" });
    await expect(page.locator('form[method="post"]')).toBeAttached();
    await expect(page.getByRole("button", { name: "로그인" })).toBeEnabled();
  });

  test("signing in and out through the page", async ({ page }) => {
    await page.goto("/ko/login");
    await page.locator('[name="email"]').fill(ADMIN.email);
    await page.locator('[name="password"]').fill(ADMIN.password);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/ko$/);

    const farm = new Farm(page);
    const menu = await farm.openAccountMenu();
    await menu.getByRole("menuitem", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/ko\/login$/);
    await page.goto("/ko");
    await expect(page).toHaveURL(/\/ko\/login$/);
  });

  test("an admin adds and removes users", async ({ page, context }) => {
    await signIn(context);
    await page.goto("/ko");
    const menu = await new Farm(page).openAccountMenu();
    await menu.getByRole("menuitem", { name: "사용자 관리" }).click();
    await expect(page).toHaveURL(/\/ko\/users$/);
    const row = (email: string) => page.locator(`[data-user="${email}"]`);
    await expect(row(ADMIN.email)).toBeVisible();
    await expect(row(ADMIN.email).getByRole("button")).toHaveCount(0);

    const add = async (email: string, password: string) => {
      await page.locator('[name="name"]').fill("임시");
      await page.locator('[name="email"]').fill(email);
      await page.locator('[name="password"]').fill(password);
      await page.getByRole("button", { name: "추가", exact: true }).click();
    };
    await add("short@terranova.test", "short");
    await expect(row("short@terranova.test")).toHaveCount(0);

    await add("temp@terranova.test", "correct-horse-3");
    await expect(row("temp@terranova.test")).toBeVisible();

    await row("temp@terranova.test").getByRole("button", { name: "삭제" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "삭제" }).click();
    await expect(row("temp@terranova.test")).toHaveCount(0);
  });

  test("a viewer can watch but has no controls", async ({ browser, context }) => {
    await signIn(context);
    await createUser(context, VIEWER);

    const viewerContext = await browser.newContext({ baseURL: "http://localhost:3000" });
    await signIn(viewerContext, VIEWER.email, VIEWER.password);
    const viewerPage = await viewerContext.newPage();
    const farm = new Farm(viewerPage);
    await farm.open();

    await expect(viewerPage.getByText("조회 전용")).toBeVisible();
    await stack.triggerAlarm("zone-d");
    await expect(viewerPage.getByText("D 구역에 물을 줄 시간이에요")).toBeVisible();
    await expect(farm.confirmButton()).toHaveCount(0);
    await expect(
      viewerPage.locator("[data-section-water], [data-section-menu], [data-add-crop], [data-menu-button]"),
    ).toHaveCount(0);
    await expect(farm.switchInput("zone-a", "vent")).toBeDisabled();

    await farm.field("zone-a").click({ button: "right" });
    await expect(viewerPage.locator("[data-zone-menu]")).toHaveCount(0);

    const menu = await farm.openAccountMenu();
    await expect(menu.getByRole("menuitem", { name: "사용자 관리" })).toHaveCount(0);
    await viewerPage.goto("/ko/users");
    await expect(viewerPage.getByText("관리자만")).toBeVisible();
    await viewerContext.close();
  });
});
