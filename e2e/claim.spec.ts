import { expect, test } from "@playwright/test";
import { openMoveIn, skipPasskey, walkedOnto, watchErrors } from "./support";

/**
 * A newcomer's way home on a phone: Move in from the town square as a guest (decision 0380), the
 * picker of empty plots open on its own as she steps in with its first pick marked (decision
 * 0377), closed to look around first, the d-pad saying what's in the way, Claim plot in the
 * Commons opening the picker again (decision 0143), the one picked claimed with `settle`, a home
 * picked from the designs drawn on her plot and built in one tap with nothing opening after it
 * (decision 0144, RFC 0032), and the starter seeds in Your things, which takes Claim plot's place
 * in the HUD.
 */
test("a newcomer claims a plot from the Commons, builds a design, and finds seeds", async ({
  page,
}) => {
  const errors = watchErrors(page, { console: "none" });
  await openMoveIn(page);
  await page.fill("#join-name", "Linden");
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

  await test.step("the picker is already open, its first pick marked, and closing it looks around first", async () => {
    const picker = page.getByRole("dialog", { name: "Pick a plot" });
    await expect(picker).toBeVisible();
    await expect(picker.locator(".claim-pick").first()).toHaveClass(/claim-first/);
    await expect(picker.locator(".claim-pick").first()).toContainText("First pick");
    await page.screenshot({ path: "test-results/claim-first.png" });
    await picker.getByRole("button", { name: "Close" }).click();
    await expect(picker).toBeHidden();
    // The passkey offer waits for the picker, then comes once (decision 0378).
    await skipPasskey(page);
    // With no plot yet the world shows walking, Claim plot, and Chat (decision 0234).
    await expect(page.locator("#chat-toggle")).toBeVisible();
    for (const id of ["build", "home", "hud-invite", "sound"])
      await expect(page.locator(`#${id}`)).toBeHidden();
  });

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
    // Beside the shop, a button says how to go in.
    await expect(page.locator("#world-enter")).toHaveText("Shop");
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
    // the plot smoke.spec walks onto from spawn and claims where it stands.
    const smokes = walkedOnto((await world()).config).join(",");
    const live = picker.locator(`button[data-plot]:not([data-plot="${smokes}"]):not([disabled])`);
    await expect(async () => {
      if (await picker.isVisible()) await live.first().click({ timeout: 2_000 });
      await expect(home).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    const plots = (await world()).plots as { ownerId: string }[];
    expect(plots.filter((p) => p.ownerId === id)).toHaveLength(1);
  });

  await test.step("a design picked and built in one tap brings the first pantry, then the name ask", async () => {
    // The designs drawn on her plot, and both choices on a phone's screen at once.
    const offer = page.getByRole("dialog", { name: "This plot is yours" });
    const designs = offer.getByRole("group", { name: "Designs" });
    await expect(designs.locator("canvas")).toHaveCount(9);
    await designs.getByRole("button", { name: /Greenhouse/ }).click();
    await expect(designs.getByRole("button", { name: /Greenhouse/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await offer
      .getByRole("group", { name: "Walls" })
      .getByRole("button", { name: "Stone" })
      .click();
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
    await page.getByRole("button", { name: "Build this home" }).click();
    await expect(offer.getByRole("button", { name: "I'll build it myself" })).toBeDisabled();
    await expect(offer.getByRole("button", { name: "Build this home" })).toBeDisabled();
    release();
    // The home is up and nothing else opens: the world's notice says what the pantry brought, and
    // the first seed and the plot's name are the next-step chip's (decision 0380).
    await expect(offer).toBeHidden();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator("#toast")).toContainText("Your first pantry");
    await page.screenshot({ path: "test-results/claim-home.png" });
    const r = await me();
    expect(r.hearth).toEqual({ x: r.x, y: r.y });
    // The greenhouse in stone stands round her hearth, with nothing off about it.
    const size = (await world()).config.plotSize;
    const plot = `${Math.floor(r.x / size)}/${Math.floor(r.y / size)}`;
    const plan = (await (await page.request.get(`/v1/plots/${plot}/plan`)).json()).plan;
    expect(plan.map.floors[0].blocks[1]).toBe(".GGGGG..");
    expect(plan.map.floors[0].blocks[2]).toBe(".S...S.p");
    expect(plan.notes).toEqual([]);
  });

  await test.step("Your things takes Claim plot's place, and the seeds are there", async () => {
    await expect(page.locator("#claim")).toBeHidden();
    await page.click("#hud-things");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByText(/2 lemon seeds/i)).toBeVisible();
  });

  await test.step("your own profile links to your things", async () => {
    await page.goto(`/r/${id}`);
    await page.click("#profile-things");
    await expect(page).toHaveURL(/\/inventory$/);
  });

  expect(errors).toEqual([]);
});
