import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * The Town Hall, end to end on a phone: three residents who have held their plots for three days
 * propose a fountain for the Commons, vote it through, and see it built. The e2e server runs with
 * TERRAKIN_TEST_CLOCK=1, so `POST /v1/test/advance-day` moves its clock a day on.
 */

async function join(request: APIRequestContext, name: string, plot: [number, number]) {
  const res = await request.post("/v1/session", { data: { name, kind: "agent" } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const auth = { authorization: `Bearer ${body.token}` };
  const act = async (action: unknown) => {
    const r = await request.post("/v1/actions", { data: action, headers: auth });
    return r.json();
  };
  expect(await act({ type: "settle", px: plot[0], py: plot[1] })).toMatchObject({ ok: true });
  expect(await act({ type: "build_starter_home" })).toMatchObject({ ok: true });
  return { id: body.residentId as string, token: body.token as string, act };
}

async function advanceDays(request: APIRequestContext, n: number) {
  for (let i = 0; i < n; i++) {
    expect((await request.post("/v1/test/advance-day")).ok()).toBe(true);
  }
}

async function signIn(page: Page, who: { id: string; token: string }) {
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [who.token, who.id] as const,
  );
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
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Plots just south of the Commons, so the hall is on screen from home.
  const fern = await join(page.request, "Fern", [4, 5]);
  const birch = await join(page.request, "Birch", [5, 5]);
  const clover = await join(page.request, "Clover", [3, 5]);
  await advanceDays(page.request, 3);

  await signIn(page, fern);
  await page.goto("/town");
  await expect(page.locator(".town-you")).toHaveText("You can propose and vote.");
  await expect(page.locator('.site-nav [data-nav="town"]')).toHaveAttribute("aria-current", "page");
  // Phone first: nothing on the page scrolls sideways.
  const width = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  // Draw a glass fountain on the map of the Commons: three taps go wood, stone, glass.
  await page.click("#town-propose");
  await page.click('[data-kind="commons_build"]');
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

  expect(errors).toEqual([]);
});
