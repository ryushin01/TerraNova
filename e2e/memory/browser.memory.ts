import type { CDPSession, Page } from "@playwright/test";
import { createAdmin, expect, Farm, signIn, test, useStack } from "../fixtures";

const ROUNDS = Number(process.env.MEMORY_ROUNDS ?? 20);

async function measure(page: Page, cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  const cssRules = await page.evaluate(() =>
    [...document.styleSheets].reduce((total, sheet) => {
      try {
        return total + sheet.cssRules.length;
      } catch {
        return total;
      }
    }, 0),
  );
  return {
    heapMB: value("JSHeapUsedSize") / 1048576,
    nodes: value("Nodes"),
    listeners: value("JSEventListeners"),
    cssRules,
  };
}

test.describe("browser memory", () => {
  useStack({}, { SIM_INITIAL_SOIL: "30" });

  test.use({ viewport: { width: 1280, height: 2600 } });
  test.beforeAll(createAdmin);

  test("repeated use leaves nothing behind", async ({ page, context }) => {
    test.setTimeout(ROUNDS * 30_000);
    await signIn(context);
    const farm = new Farm(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Network.enable");
    let openSockets = 0;
    const appSockets = new Set<string>();
    cdp.on("Network.webSocketCreated", ({ requestId, url }) => {
      if (url.includes("/socket.io/")) {
        appSockets.add(requestId);
        openSockets++;
      }
    });
    cdp.on("Network.webSocketClosed", ({ requestId }) => {
      if (appSockets.delete(requestId)) openSockets--;
    });
    await farm.open();

    let pixel = 0;
    const samples = [];
    for (let round = 0; round < ROUNDS; round++) {
      const a = (await farm.card("zone-a").boundingBox())!;
      const b = (await farm.card("zone-b").boundingBox())!;
      for (let drag = 0; drag < 20; drag++) {
        pixel++;
        await page.mouse.move(a.x - 14, a.y - 10);
        await page.mouse.down();
        // Different coordinates every time, which would expose styles generated per position.
        await page.mouse.move(b.x + b.width - 20 - (pixel % 97), b.y + b.height - 20 - (pixel % 53), { steps: 5 });
        await page.mouse.up();
        await page.keyboard.press("Escape");
      }
      await page.locator('[data-menu-button="zone-c"]').click();
      await page.keyboard.press("Escape");
      await farm.plot("zone-d").click({ button: "right" });
      await page.keyboard.press("Escape");
      await page.locator("[data-add-crop]").click();
      await page.locator('[name="crop-name"]').fill(`토마토${pixel}`);
      await page.keyboard.press("Escape");
      await page.locator('[name="crop-name"]').waitFor({ state: "detached" });

      // Leave the dashboard and return, unmounting everything including the live connection.
      for (const [item, url] of [
        ["사용자 관리", /\/ko\/users$/],
        ["구역 현황", /\/ko$/],
      ] as const) {
        const menu = await farm.openAccountMenu();
        await menu.getByRole("menuitem", { name: item }).click();
        await expect(page).toHaveURL(url);
      }
      await expect(farm.card("zone-f").getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d/);
      await page.waitForTimeout(1000);

      // The connection starts on HTTP polling and upgrades a moment later, so wait for it. A leak
      // would show as more than one, and the assertion below still catches that.
      await expect.poll(() => openSockets, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      const sample = await measure(page, cdp);
      samples.push(sample);
      console.log(
        `round ${round + 1}: heap ${sample.heapMB.toFixed(1)}MB, nodes ${sample.nodes}, listeners ${sample.listeners}, cssRules ${sample.cssRules}, sockets ${openSockets}`,
      );
      expect(openSockets).toBe(1);
    }

    const warm = samples[2]!;
    const last = samples.at(-1)!;
    expect(last.nodes).toBeLessThanOrEqual(warm.nodes * 1.05);
    expect(last.cssRules).toBeLessThanOrEqual(warm.cssRules + 10);
    expect(last.listeners).toBeLessThanOrEqual(warm.listeners * 1.25);
    // Heap moves around between rounds, so compare averages: late rounds against early ones.
    const heaps = samples.slice(2).map((sample) => sample.heapMB);
    const half = Math.floor(heaps.length / 2);
    const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
    const growth = average(heaps.slice(half)) / average(heaps.slice(0, half));
    console.log(`heap, later half against earlier half: ${growth.toFixed(2)}x`);
    expect(growth).toBeLessThan(1.25);
  });
});
