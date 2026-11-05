import { createAdmin, createUser, expect, Farm, signIn, test, useStack } from "./fixtures";
import { WEB_ORIGIN } from "./ports";

/** Local time in the farm's time zone, a number of minutes from now. */
function seoulTime(minutesFromNow: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(Date.now() + minutesFromNow * 60_000);
}

/**
 * The server recovers a slot missed by a restart until its alarm would have expired (30 minutes
 * by default), so a fresh server starts alarming at once if a default time has just passed. Pick
 * defaults away from the clock, or the suite fails whenever it runs right after one of them.
 */
function defaultsAwayFromNow(): readonly [string, string] {
  const minutes = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour! * 60 + minute!;
  };
  const now = minutes(seoulTime(0));
  const isNear = (time: string) => {
    const sinceSlot = (now - minutes(time) + 1440) % 1440;
    return sinceSlot <= 40 || sinceSlot >= 1440 - 30;
  };
  const pairs = [
    ["07:15", "19:45"],
    ["01:15", "13:45"],
  ] as const;
  return pairs.find((pair) => !pair.some(isNear)) ?? pairs[0];
}

const [FIRST, SECOND] = defaultsAwayFromNow();
const DEFAULTS = `${FIRST}, ${SECOND}`;
const AFTER_EDIT = ["06:05", FIRST, "12:30"].sort().join(", ");

test.describe.configure({ mode: "serial" });

test.describe("alarm times", () => {
  const stack = useStack({ WATERING_TIMES: `${FIRST},${SECOND}` }, { SIM_INITIAL_SOIL: "30" });

  test.beforeAll(createAdmin);
  test.beforeEach(({ context }) => signIn(context));

  const times = (farm: Farm, crop: string) => farm.page.locator(`[data-section-times="${crop}"]`);
  const openEditor = async (farm: Farm, crop: string) => {
    await farm.page.locator(`[data-section-times-edit="${crop}"]`).click();
    await expect(farm.page.locator("[data-alarm-times-dialog]")).toBeVisible();
  };
  const addTime = async (farm: Farm, time: string) => {
    await farm.page.locator('[name="alarm-time"]').fill(time);
    await farm.page.locator("[data-alarm-time-add]").click();
  };

  test("sections start with the default times, and cancel changes nothing", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await expect(times(farm, "rice")).toContainText(DEFAULTS);

    await openEditor(farm, "rice");
    await addTime(farm, "12:00");
    await page.getByRole("button", { name: "취소" }).click();
    await expect(times(farm, "rice")).toContainText(DEFAULTS);
  });

  test("times can be added and removed, per section, and survive a restart", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openEditor(farm, "rice");
    await addTime(farm, "12:30");
    await addTime(farm, "12:30");
    await addTime(farm, "06:05");
    await expect(page.locator("[data-alarm-time]")).toHaveCount(4);
    await page.locator(`[data-alarm-time="${SECOND}"]`).getByRole("button").click();
    await page.locator("[data-alarm-times-save]").click();

    await expect(times(farm, "rice")).toContainText(AFTER_EDIT);
    await expect(times(farm, "lettuce")).toContainText(DEFAULTS);

    await stack.restartServer();
    await page.reload();
    await expect(times(farm, "rice")).toContainText(AFTER_EDIT);
  });

  test("removing every time turns the section's alarms off", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openEditor(farm, "lettuce");
    await page.locator(`[data-alarm-time="${FIRST}"]`).getByRole("button").click();
    await page.locator(`[data-alarm-time="${SECOND}"]`).getByRole("button").click();
    await page.locator("[data-alarm-times-save]").click();
    await expect(times(farm, "lettuce")).toContainText("알람 없음");
  });

  test("a time set for the next minute alarms only that section, and never waters by itself", async ({ page }) => {
    test.setTimeout(150_000);
    const farm = new Farm(page);
    await farm.open();
    // Far enough ahead that saving can't reach that minute, even on a busy machine.
    const at = seoulTime(new Date().getSeconds() > 30 ? 2 : 1);
    await openEditor(farm, "bellflower");
    await page.locator(`[data-alarm-time="${FIRST}"]`).getByRole("button").click();
    await page.locator(`[data-alarm-time="${SECOND}"]`).getByRole("button").click();
    await addTime(farm, at);
    await page.locator("[data-alarm-times-save]").click();
    await expect(times(farm, "bellflower")).toContainText(at);
    // Saved after its minute began, it would correctly wait for tomorrow, so that isn't a failure here.
    expect(seoulTime(0) < at || at < "00:05", `saved too late for ${at}, now ${seoulTime(0)}`).toBe(true);

    await expect(farm.field("zone-a")).toHaveAttribute("data-look", "alarm", { timeout: 130_000 });
    await expect(farm.field("zone-b")).toHaveAttribute("data-look", "alarm");
    await farm.expectLook("zone-c", "dry");
    await farm.expectLook("zone-e", "dry");
    await expect(farm.switchInput("zone-a", "vent")).not.toBeChecked();
    await expect(farm.card("zone-a")).not.toContainText("급수 중");
  });

  test("a time already passed today does not alarm on saving", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await openEditor(farm, "rice");
    await addTime(farm, seoulTime(-1));
    await page.locator("[data-alarm-times-save]").click();
    await expect(times(farm, "rice")).toContainText(seoulTime(-1).slice(0, 2));
    await page.waitForTimeout(3000);
    await farm.expectLook("zone-c", "dry");
    await farm.expectLook("zone-d", "dry");
  });

  test("a new crop starts with the default times", async ({ page }) => {
    const farm = new Farm(page);
    await farm.open();
    await page.locator("[data-add-crop]").click();
    await page.locator('[name="name"]').fill("토마토");
    await page.locator("[data-add-crop-submit]").click();
    const section = page.locator("[data-section]", { has: page.getByRole("heading", { name: "토마토" }) });
    await expect(section.locator("[data-section-times]")).toContainText(DEFAULTS);
  });

  test("a viewer sees the times but cannot change them", async ({ browser, context }) => {
    await signIn(context);
    await createUser(context, {
      name: "조회자",
      email: "viewer@terranova.test",
      password: "correct-horse-2",
      role: "viewer",
    });
    const viewerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    await signIn(viewerContext, "viewer@terranova.test", "correct-horse-2");
    const page = await viewerContext.newPage();
    const farm = new Farm(page);
    await farm.open();
    await expect(times(farm, "rice")).toContainText("06:05");
    await expect(page.locator("[data-section-times-edit]")).toHaveCount(0);
    await viewerContext.close();
  });
});
