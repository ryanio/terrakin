import { expect, test } from "@playwright/test";
import { watchErrors } from "./support";

/**
 * A newcomer's way home on a phone: the d-pad saying what's in the way, Claim plot in the Commons
 * opening the picker of empty plots (decision 0143), the one picked claimed with `settle`, a
 * starter home in one tap with the first pantry said in words (decision 0144), and the starter
 * seeds in Your things, which takes Claim plot's place in the HUD.
 */
test("a newcomer claims a plot from the Commons, takes a starter home, and finds seeds", async ({
  page,
}) => {
  const errors = watchErrors(page, { console: "none" });
  await page.goto("/world");
  await page.fill("#join-name", "Linden");
  await page.click("#join-color button[data-value=sun]");
  await page.click("#world-join button[type=submit]");
  await expect(page.locator("#hud")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terrakin.resident")))
    .toMatch(/^r_/);
  const id = await page.evaluate(() => localStorage.getItem("terrakin.resident"));
  const world = () => page.request.get("/v1/world").then((r) => r.json());
  const me = async () =>
    (await world()).residents.find((r: { id: string }) => r.id === id) as {
      x: number;
      y: number;
      hearth?: { x: number; y: number };
    };
  await expect.poll(async () => (await me()) !== undefined).toBe(true);

  await test.step("the d-pad walks south from spawn until the shop, then says it's in the way", async () => {
    const start = await me();
    const { shop } = await world();
    // The shop stands across the spawn column, a few tiles south.
    const front = Math.min(
      ...(shop as { x: number; y: number }[]).filter((t) => t.x === start.x).map((t) => t.y),
    );
    expect(front).toBeGreaterThan(start.y);
    for (let i = 0; i < front - start.y + 1; i++) await page.click('[data-dir="s"]');
    await expect.poll(async () => (await me()).y).toBe(front - 1);
    await expect(page.locator("#toast")).toContainText("The shop is in the way.");
  });

  await test.step("Claim plot in the Commons opens the picker, and picking settles there", async () => {
    await page.click("#claim");
    const picker = page.getByRole("dialog", { name: "Pick a plot" });
    await expect(picker).toBeVisible();
    await expect(picker.locator(".claim-pick").first()).toBeVisible();
    await expect(picker.locator(".claim-pick canvas").first()).toBeVisible();
    await page.screenshot({ path: "test-results/claim-picker.png" });
    const home = page.getByRole("dialog", { name: "This plot is yours" });
    // Specs share one world: a plot taken meanwhile says so, and the next one is picked. Never
    // plot (3, 3), which smoke.spec walks onto from spawn and claims where it stands.
    const live = picker.locator('button[data-plot]:not([data-plot="3,3"]):not([disabled])');
    await expect(async () => {
      if (await picker.isVisible()) await live.first().click({ timeout: 2_000 });
      await expect(home).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    const plots = (await world()).plots as { ownerId: string }[];
    expect(plots.filter((p) => p.ownerId === id)).toHaveLength(1);
  });

  await test.step("a starter home in one tap brings the first pantry, then the name ask", async () => {
    // Both choices fit on a phone's screen at once.
    const offer = page.getByRole("dialog", { name: "This plot is yours" });
    await expect(offer.getByRole("button", { name: "I'll build it myself" })).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({ path: "test-results/claim-offer.png" });
    // Hold the build on its way, so the sheet can be seen mid-build: neither choice can be
    // tapped then, so "I'll build it myself" can't open a second sheet over the first.
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route(
      "**/v1/actions",
      async (route) => {
        await held;
        await route.continue();
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Build me a starter home" }).click();
    await expect(offer.getByRole("button", { name: "I'll build it myself" })).toBeDisabled();
    await expect(offer.getByRole("button", { name: "Build me a starter home" })).toBeDisabled();
    release();
    const name = page.getByRole("dialog", { name: "Name your new plot" });
    await expect(name).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(name.locator("#home-news")).toContainText("seeds of 5 kinds");
    await page.screenshot({ path: "test-results/claim-home.png" });
    const r = await me();
    expect(r.hearth).toEqual({ x: r.x, y: r.y });
    await name.locator("#plot-name-input").fill("Linden's Lemon Grove");
    await name.locator("#plot-name-save").click();
    await expect(name).toBeHidden();
  });

  await test.step("Your things takes Claim plot's place, and the seeds are there", async () => {
    await expect(page.locator("#claim")).toBeHidden();
    await page.click("#hud-things");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByText(/2 lemon seeds/i)).toBeVisible();
    await expect(page.getByText(/2 herb seeds/i)).toBeVisible();
  });

  await test.step("your own profile links to your things", async () => {
    await page.goto(`/r/${id}`);
    await page.click("#profile-things");
    await expect(page).toHaveURL(/\/inventory$/);
  });

  expect(errors).toEqual([]);
});
