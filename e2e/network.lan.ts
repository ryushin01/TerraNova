import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { request as httpsRequest } from "node:https";
import { expect, test } from "@playwright/test";

const address = Object.values(networkInterfaces())
  .flat()
  .find((item) => item && item.family === "IPv4" && !item.internal)!.address;
const ADMIN = { name: "관리자", email: "admin@terranova.test", password: "correct-horse-1" };
const PUBLIC = `https://${address}:8443`;
const LOCAL = "https://localhost:8443";

/** HTTPS request that skips the self-signed certificate check, from a chosen address. */
function post(url: string, path: string, body: unknown, origin: string, extra: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const target = new URL(path, url);
    const req = httpsRequest(
      target,
      { method: "POST", rejectUnauthorized: false, headers: { "content-type": "application/json", origin, ...extra } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const canConnect = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: address, port, timeout: 1500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });

test.describe.configure({ mode: "serial" });

test("only the HTTPS port is reachable from the network", async () => {
  expect(await canConnect(8443)).toBe(true);
  expect(await canConnect(3000)).toBe(false);
  expect(await canConnect(4000)).toBe(false);
  expect(await canConnect(1883)).toBe(false);
});

test("the first admin can only be created on this computer", async () => {
  expect(await post(PUBLIC, "/api/setup", ADMIN, PUBLIC)).toBe(403);
  expect(await post(LOCAL, "/api/setup", ADMIN, LOCAL)).toBe(201);
});

test("development routes are off", async () => {
  expect(await post(PUBLIC, "/dev/alarms/zone-a", {}, PUBLIC)).not.toBe(201);
});

test("a phone signs in, sees live data, and waters a field", async ({ page, context }) => {
  const insecure = await page.goto("/ko");
  expect(insecure?.ok()).toBe(true);
  await expect(page).toHaveURL(`${PUBLIC}/ko/login`);

  await page.locator('[name="email"]').fill(ADMIN.email);
  await page.locator('[name="password"]').fill(ADMIN.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(`${PUBLIC}/ko`);

  const session = (await context.cookies()).find((cookie) => cookie.name.includes("session_token"));
  expect(session?.secure).toBe(true);
  expect(session?.httpOnly).toBe(true);

  const card = page.locator('[data-zone="zone-a"]');
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d/);
  await expect(card).toContainText("온라인");

  await page.locator('[data-menu-button="zone-a"]').click();
  await page.locator('[data-zone-menu="zone-a"]').getByRole("menuitem", { name: "물 주기" }).click();
  await expect(card.locator("[data-look]")).toHaveAttribute("data-look", "watering");
  await expect(card).toContainText("물주기 완료");
  await expect(card.locator("[data-look]")).toHaveAttribute("data-look", "completed");

  const scroll = await page.evaluate(() => ({ inner: innerWidth, width: document.documentElement.scrollWidth }));
  expect(scroll.width).toBe(scroll.inner);
});

test("the live connection also works when WebSockets are unavailable", async ({ context, page }) => {
  // Some phones refuse WebSockets on self-signed certificates and stay on HTTP polling.
  await context.addInitScript(() => {
    (window as any).WebSocket = undefined;
  });
  await page.request.post("/api/auth/sign-in/email", {
    headers: { origin: PUBLIC },
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  await page.goto("/ko");
  await expect(page.locator('[data-zone="zone-b"]').getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d/);
  await expect(page.locator('[data-zone="zone-b"]')).toContainText("온라인");
});

test("repeated wrong passwords are blocked, even with a forged address", async () => {
  const attempt = (forged?: string) =>
    post(PUBLIC, "/api/auth/sign-in/email", { email: ADMIN.email, password: "wrong-password" }, PUBLIC, forged ? { "x-forwarded-for": forged } : {});
  const results: number[] = [];
  for (let index = 0; index < 8; index++) results.push(await attempt(`203.0.113.${index}`));
  // Successful sign-ins from earlier tests count too, so fewer than 5 of these may get through.
  expect(results.filter((status) => status === 401).length).toBeGreaterThan(0);
  expect(results.filter((status) => status === 401).length).toBeLessThanOrEqual(5);
  expect(results.at(-1)).toBe(429);

  // The limit lasts a full minute, not Better Auth's default of ten seconds.
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  expect(await attempt()).toBe(429);
});
