import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "@playwright/test";
import { ADMIN, createAdmin, createUser, expect, Farm, signIn, test, useStack } from "./fixtures";
import { PORT_ENV, WEB_ORIGIN } from "./ports";

const WORKER = { name: "김작업", email: "worker@terranova.test", password: "correct-horse-2", role: "operator" };
const ORIGIN = WEB_ORIGIN;

const trySignIn = async (context: BrowserContext, email: string, password: string) => {
  const response = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: ORIGIN },
    data: { email, password },
  });
  const status = response.status();
  // Anything else isn't a verdict on the password, so report what the server actually said.
  if (status !== 200 && status !== 401) throw new Error(`sign-in returned ${status}: ${await response.text()}`);
  return status;
};

async function changeOwnPassword(page: Page, current: string, next: string, confirm = next) {
  const menu = await new Farm(page).openAccountMenu();
  await menu.getByRole("menuitem", { name: "비밀번호 변경" }).click();
  await page.locator('[name="current"]').fill(current);
  await page.locator('[name="next"]').fill(next);
  await page.locator('[name="confirm"]').fill(confirm);
  await page.locator("[data-change-password-submit]").click();
}

test.describe.configure({ mode: "serial" });

test.describe("passwords", () => {
  const stack = useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);

  test("an admin resets someone's password, ending that person's sign-ins at once", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(90_000);
    await signIn(context);
    await createUser(context, WORKER);

    const workerContext = await browser.newContext({ baseURL: ORIGIN });
    await signIn(workerContext, WORKER.email, WORKER.password);
    const workerPage = await workerContext.newPage();
    const workerFarm = new Farm(workerPage);
    await workerFarm.open();

    await page.goto("/ko/users");
    const row = page.locator(`[data-user="${WORKER.email}"]`);
    await row.getByRole("button", { name: "비밀번호 재설정" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(WORKER.name);

    // The browser enforces the minimum length here.
    await dialog.locator('[name="new-password"]').fill("short");
    await page.locator("[data-reset-password-submit]").click();
    await expect(dialog).toBeVisible();

    await dialog.locator('[name="new-password"]').fill("reset-by-admin-1");
    await page.locator("[data-reset-password-submit]").click();
    await expect(page.getByText("비밀번호를 재설정했어요")).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // Their open page loses access rather than continuing with the old sign-in.
    await expect(workerPage).toHaveURL(/\/ko\/login$/, { timeout: 45_000 });
    expect(await trySignIn(workerContext, WORKER.email, WORKER.password)).toBe(401);
    expect(await trySignIn(workerContext, WORKER.email, "reset-by-admin-1")).toBe(200);
    await workerContext.close();
  });

  test("your own row has no reset button, since that belongs to changing your password", async ({ page, context }) => {
    await signIn(context);
    await page.goto("/ko/users");
    await expect(page.locator(`[data-user="${ADMIN.email}"]`).getByRole("button")).toHaveCount(0);
  });

  test("a non-admin cannot reset anyone's password", async ({ context, browser }) => {
    await signIn(context);
    const workerContext = await browser.newContext({ baseURL: ORIGIN });
    await signIn(workerContext, WORKER.email, "reset-by-admin-1");
    const response = await workerContext.request.post("/api/auth/admin/set-user-password", {
      headers: { origin: ORIGIN },
      data: { userId: "anyone", newPassword: "another-password-1" },
    });
    expect(response.status()).toBe(403);
    await workerContext.close();
  });

  test("changing your own password checks the old one and keeps this page working", async ({
    page,
    context,
    browser,
  }) => {
    // Waits out the server's 30-second session check, which is what would end this page's connection.
    test.setTimeout(120_000);
    await signIn(context);
    const farm = new Farm(page);
    await farm.open();

    const otherContext = await browser.newContext({ baseURL: ORIGIN });
    await signIn(otherContext);
    const otherPage = await otherContext.newPage();
    await new Farm(otherPage).open();

    await changeOwnPassword(page, ADMIN.password, "changed-password-1", "does-not-match-1");
    await expect(page.getByText("새 비밀번호가 서로 달라요")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();

    await changeOwnPassword(page, "wrong-password-1", "changed-password-1");
    await expect(page.getByText("현재 비밀번호가 맞지 않거나")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();

    await changeOwnPassword(page, ADMIN.password, "changed-password-1");
    await expect(page.getByText("비밀번호를 변경했어요")).toBeVisible();

    // Other devices are signed out, but this page stays signed in and live.
    await expect(otherPage).toHaveURL(/\/ko\/login$/, { timeout: 45_000 });
    await otherContext.close();
    await page.waitForTimeout(32_000);
    await expect(page).toHaveURL(/\/ko$/);
    await farm.toggle("zone-a", "vent");
    await expect(farm.switchInput("zone-a", "vent")).toBeChecked();
    await page.reload();
    await farm.expectLook("zone-a", "dry");

    expect(await trySignIn(context, ADMIN.email, ADMIN.password)).toBe(401);
    expect(await trySignIn(context, ADMIN.email, "changed-password-1")).toBe(200);
  });

  test("the recovery command works once the server is stopped", async ({ context }) => {
    const run = promisify(execFile);
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const env = { ...process.env, ...PORT_ENV, DATA_DIR: stack.dataDir };

    await expect(run("bun", ["run", "admin:reset-password", ADMIN.email], { cwd: root, env })).rejects.toThrow(
      /Stop it first/,
    );

    await stack.stopServer();
    const { stdout } = await run("bun", ["run", "admin:reset-password", ADMIN.email], { cwd: root, env });
    const temporary = /^ {2}(\S+)$/m.exec(stdout)?.[1];
    expect(temporary).toBeTruthy();

    await stack.startServer();
    expect(await trySignIn(context, ADMIN.email, "changed-password-1")).toBe(401);
    expect(await trySignIn(context, ADMIN.email, temporary!)).toBe(200);
  });
});
