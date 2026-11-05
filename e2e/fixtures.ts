import { type BrowserContext, test as base, expect, type Locator, type Page } from "@playwright/test";
import { Stack } from "./stack";

const ORIGIN = "http://localhost:3000";
const BACKEND = "http://127.0.0.1:4000";

export const ADMIN = { name: "관리자", email: "admin@terranova.test", password: "correct-horse-1" };

/** Errors expected when a test deliberately stops the backend or fails a login. */
const EXPECTED_ERRORS = /ERR_CONNECTION|WebSocket|xhr|polling|Failed to load resource/i;

/** Fails any test whose page throws or reports an error, which catches hydration problems. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on("weberror", (error) => errors.push(error.error().message));
      context.on("console", (message) => {
        if (message.type() === "error" && !EXPECTED_ERRORS.test(message.text())) errors.push(message.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Runs a real backend and simulator for the enclosing describe block. */
export function useStack(serverEnv: Record<string, string> = {}, simulatorEnv: Record<string, string> = {}): Stack {
  const stack = new Stack(serverEnv, simulatorEnv);
  test.beforeAll(() => stack.start());
  test.afterAll(() => stack.stop());
  return stack;
}

export async function createAdmin(): Promise<void> {
  const response = await fetch(`${BACKEND}/api/setup`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  expect(response.status).toBe(201);
}

export async function signIn(context: BrowserContext, email = ADMIN.email, password = ADMIN.password): Promise<void> {
  const response = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: ORIGIN },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

export async function createUser(
  context: BrowserContext,
  user: { name: string; email: string; password: string; role: string },
) {
  const response = await context.request.post("/api/auth/admin/create-user", {
    headers: { origin: ORIGIN },
    data: user,
  });
  expect(response.status()).toBe(200);
}

/** The dashboard as a user sees it. */
export class Farm {
  constructor(readonly page: Page) {}

  card = (zone: string): Locator => this.page.locator(`[data-zone="${zone}"]`);
  plot = (zone: string): Locator => this.page.locator(`[data-plot-menu="${zone}"]`);
  field = (zone: string): Locator => this.card(zone).locator("[data-look]");
  firstCell = (zone: string): Locator => this.card(zone).locator("[data-cell]").first();
  section = (crop: string): Locator => this.page.locator(`[data-section="${crop}"]`);
  zoneMenu = (zone: string): Locator => this.page.locator(`[data-zone-menu="${zone}"]`);
  switchOf = (zone: string, actuator: string): Locator => this.card(zone).locator(`[data-actuator="${actuator}"]`);
  switchInput = (zone: string, actuator: string): Locator => this.switchOf(zone, actuator).locator("input");
  confirmButton = (): Locator => this.page.getByRole("button", { name: "확인하고 물 주기" });
  menuItem = (menu: Locator, name: string): Locator => menu.getByRole("menuitem", { name });

  async open(path = "/ko", zone = "zone-f"): Promise<void> {
    await this.page.goto(path);
    await expect(this.card(zone).getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d/);
  }

  async expectLook(zone: string, look: string): Promise<void> {
    await expect(this.field(zone)).toHaveAttribute("data-look", look);
  }

  async cellColor(zone: string): Promise<string> {
    // Past the 0.3s color transition, so the value isn't caught halfway between two states.
    await this.page.waitForTimeout(450);
    return this.firstCell(zone).evaluate((cell) => getComputedStyle(cell).backgroundColor);
  }

  async toggle(zone: string, actuator: string): Promise<void> {
    await this.switchOf(zone, actuator).locator('[data-part="control"]').click();
  }

  async expectToastsGone(): Promise<void> {
    await expect(this.page.locator('[data-scope="toast"][data-part="root"]')).toHaveCount(0, { timeout: 15_000 });
  }

  /** Follows a link in the side navigation. */
  async goTo(name: string): Promise<void> {
    await this.navLink(name).click();
  }

  navLink = (name: string): Locator => this.page.getByRole("navigation").getByRole("link", { name });

  /** Opens the menu of the signed-in user in the page header. */
  async openAccountMenu(): Promise<Locator> {
    await this.page.getByRole("button", { name: "계정 메뉴" }).click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }
}
