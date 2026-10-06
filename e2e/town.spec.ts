import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  act,
  advanceDay,
  advanceMinutes,
  join,
  overflowsSideways,
  read,
  signIn,
  watchErrors,
} from "./support";

/**
 * The Town Hall, end to end on a phone: three residents who have held their plots for three days
 * propose a fountain for the Commons, vote it through, and see it built. Then Fern hosts an event
 * at her plot from the Town Hall's calendar, and Birch goes from the home wall's Happening now card
 * once it's on. The e2e server runs with TERRAKIN_TEST_CLOCK=1, so `POST /v1/test/advance-day`
 * moves its clock a day on, or some minutes.
 */

/** An agent who settles `plot` and builds the starter home, with `act` bound to it. */
async function settleAt(request: APIRequestContext, name: string, plot: [number, number]) {
  const who = await join(request, name, { kind: "agent" });
  const actAs = (action: unknown) => act(request, who.token, action);
  expect(await actAs({ type: "settle", px: plot[0], py: plot[1] })).toMatchObject({ ok: true });
  expect(await actAs({ type: "build_starter_home" })).toMatchObject({ ok: true });
  return { ...who, act: actAs };
}

async function advanceDays(request: APIRequestContext, n: number) {
  for (let i = 0; i < n; i++) await advanceDay(request);
}

// Tiles of the default Commons (32..39), clear of the hall (35..37, 32..33) and of spawn (36, 36).
const FOUNTAIN = [
  [33, 38],
  [34, 38],
  [33, 39],
  [34, 39],
] as const;

test("an eligible resident proposes a fountain, the town votes it in, and it's built", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page, { console: "none" });

  // Plots just south of the Commons, so the hall is on screen from home.
  const fern = await settleAt(page.request, "Fern", [4, 5]);
  const birch = await settleAt(page.request, "Birch", [5, 5]);
  const clover = await settleAt(page.request, "Clover", [3, 5]);
  await advanceDays(page.request, 3);

  await signIn(page, fern);
  await page.goto("/town");
  await expect(page.locator(".town-you")).toHaveText("You can propose and vote.");
  await expect(page.locator('.site-nav [data-nav="town"]')).toHaveAttribute("aria-current", "page");
  // Phone first: nothing on the page scrolls sideways.
  expect(await overflowsSideways(page)).toBe(false);

  // Draw a glass fountain on the map of the Commons: three taps go wood, stone, glass.
  await page.click("#town-propose");
  await page.click('.kind-row [data-value="commons_build"]');
  await page.fill("#propose-title", "A fountain");
  await page.fill("#propose-text", "Glass water by the south path, for <b>everyone</b>.");
  for (const [x, y] of FOUNTAIN) {
    for (let i = 0; i < 3; i++) await page.click(`.commons-map.editor [data-tile="${x},${y}"]`);
  }
  await expect(page.locator(".plan-count")).toContainText("4 of 40 blocks");
  await page.screenshot({ path: "test-results/town-propose.png" });
  await page.click("#propose-submit");

  const card = page.locator("article.proposal", { hasText: "A fountain" }).first();
  await expect(card).toBeVisible();
  // Proposal text is text, never markup.
  await expect(card.locator(".proposal-text")).toHaveText(
    "Glass water by the south path, for <b>everyone</b>.",
  );
  await expect(card.locator("b")).toHaveCount(0);
  const id = (await card.getAttribute("data-proposal")) ?? "";
  expect(id).toMatch(/^t_\d+$/);

  await card.locator('[data-choice="yes"]').click();
  await expect(card.locator('[data-choice="yes"]')).toHaveAttribute("aria-pressed", "true");
  for (const r of [birch, clover]) {
    expect(await r.act({ type: "vote", proposal: id, choice: "yes" })).toMatchObject({ ok: true });
  }
  await page.reload();
  await expect(page.locator(`[data-proposal="${id}"] .tally-counts`)).toContainText("3 yes");
  await expect(page.locator(`[data-proposal="${id}"] .tally-quorum`)).toHaveText("Passing");
  await page.screenshot({ path: "test-results/town-page.png", fullPage: true });

  // Two nights later the vote closes and the town builds it.
  await advanceDays(page.request, 2);
  const world = await (await page.request.get("/v1/world")).json();
  for (const [x, y] of FOUNTAIN) {
    expect(world.blocks).toContainEqual({ x, y, block: "glass" });
    expect(world.townBuilt).toContainEqual({ x, y, proposal: id });
  }
  await page.reload();
  await expect(page.locator(`.archive-list [data-proposal="${id}"] .proposal-status`)).toHaveText(
    "Passed",
  );

  // The fountain and the hall in the world. Tapping the hall opens the Town Hall.
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/town-world.png" });
  const hallDoor = world.townHall.find((t: { x: number; y: number }) => t.y === 33 && t.x === 36);
  expect(hallDoor).toBeTruthy();
  const me = world.residents.find((r: { id: string }) => r.id === fern.id);
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  const scale = Math.max(16, Math.floor(Math.min(vp.width, vp.height) / 13));
  await page.mouse.click(
    vp.width / 2 + (hallDoor.x - me.x) * scale,
    vp.height / 2 + (hallDoor.y - me.y) * scale,
  );
  await expect(page).toHaveURL(/\/town$/);

  // The profile counts the vote.
  await page.goto(`/r/${fern.id}`);
  await expect(page.locator(".profile-votes")).toHaveText("Voted 1 time in the Town Hall");

  await test.step("Fern hosts an event at her plot, and Birch goes once it's on", async () => {
    await page.goto("/town");
    await page.click("#event-host");
    await page.click('[aria-label="Kind of event"] [data-value="listening"]');
    await page.fill("#event-title", "Sunday records");
    await page.fill("#event-text", "Bring a song.");
    // It starts on the hour, two to three hours from now by the server's clock: keep that.
    await page.screenshot({ path: "test-results/town-schedule.png" });
    await page.click("#event-submit");
    const row = page.locator("#events .event-row", { hasText: "Sunday records" });
    await expect(row).toBeVisible();
    const id = (await row.getAttribute("data-event")) ?? "";
    expect(id).toMatch(/^e_\d+$/);
    expect(await overflowsSideways(page)).toBe(false);

    // The server's clock moves to a minute after it starts.
    const { event } = await read(page.request, birch.token, `/v1/events/${id}`);
    const now = (await (await page.request.get("/v1/world")).json()).time.nowMs;
    await advanceMinutes(page.request, Math.ceil((Date.parse(event.startsAt) - now) / 60_000) + 1);

    // Birch, on the home wall on his own phone, taps Go and lands on Fern's plot or the paths
    // around it.
    const birchPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await signIn(birchPage, birch);
    await birchPage.goto("/");
    const happening = birchPage.locator("#happening-now");
    await expect(happening).toContainText("Sunday records");
    await birchPage.screenshot({ path: "test-results/town-happening-now.png" });
    await happening.locator(`[data-event="${id}"] .event-go`).click();
    await expect(birchPage).toHaveURL(/\/world$/);
    const area = event.area as { x0: number; y0: number; x1: number; y1: number };
    const at = (await (await page.request.get("/v1/world")).json()).residents.find(
      (r: { id: string }) => r.id === birch.id,
    );
    expect(at.x).toBeGreaterThanOrEqual(area.x0);
    expect(at.x).toBeLessThanOrEqual(area.x1);
    expect(at.y).toBeGreaterThanOrEqual(area.y0);
    expect(at.y).toBeLessThanOrEqual(area.y1);
    await birchPage.close();
  });

  expect(errors).toEqual([]);
});
