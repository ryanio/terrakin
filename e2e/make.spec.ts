import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { act, freePlots, join, settler, signIn, tinyPng, watchErrors } from "./support";

/**
 * Growing, making, and giving (RFC 0005) on a phone: a resident taps a planter in the world and
 * plants herbs, comes back two days later to pick them, makes herb tea at a kitchen with a label,
 * finds it on their things page, and gives it to a friend from the friend's profile, who sends it
 * back from their own things page. Runs after coins.spec.ts, since it moves the shared clock on.
 */

async function inventory(request: APIRequestContext, token: string) {
  const res = await request.get("/v1/inventory", { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()).inventory;
}

/** The camera eases toward you; wait enough frames for it to land before tapping tiles. */
async function settleCamera(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 40;
        const tick = () => (--frames <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

/** Tap the tile `dx`, `dy` from where you stand (the middle of the screen). */
async function tapTile(page: Page, dx: number, dy: number) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  const scale = Math.max(16, Math.floor(Math.min(vp.width, vp.height) / 13));
  await settleCamera(page);
  await page.mouse.click(vp.width / 2 + dx * scale, vp.height / 2 + dy * scale);
}

test("grow herbs, make tea, and give it to a friend", async ({ page }) => {
  const errors = watchErrors(page);
  const fern = await join(page.request, "Fern");
  const olive = await join(page.request, "Olive");
  const [plot] = await freePlots(page.request, 1);
  if (!plot) throw new Error("No free plots left in the test world");
  expect(
    (await act(page.request, fern.token, { type: "settle", px: plot[0], py: plot[1] })).ok,
  ).toBe(true);
  // The starter home puts Fern on her hearth, which brings the first pantry and starter seeds.
  expect((await act(page.request, fern.token, { type: "build_starter_home" })).ok).toBe(true);
  const start = await inventory(page.request, fern.token);
  expect(start.stacks).toContainEqual({ kind: "herb_seed", count: 2 });

  await signIn(page, fern);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();

  // The build palette has the new blocks, in one row that stays on the phone's screen.
  await page.click("#build");
  const palette = await page.locator("#palette").boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(palette && palette.x >= 0 && palette.x + palette.width <= width).toBe(true);
  // A planter up and to the left of the hearth, a kitchen up and to the right.
  await page.click('[data-block="planter"]');
  await tapTile(page, -1, -1);
  await page.click('[data-block="kitchen"]');
  await tapTile(page, 1, -1);
  await page.screenshot({ path: "test-results/make-built.png" });
  const me = async () => {
    const world = await (await page.request.get("/v1/world")).json();
    return world.residents.find((r: { id: string }) => r.id === fern.id);
  };
  const { x, y } = await me();
  const blockAt = async (bx: number, by: number) => {
    const world = await (await page.request.get("/v1/world")).json();
    return world.blocks.find((b: { x: number; y: number }) => b.x === bx && b.y === by)?.block;
  };
  await expect.poll(() => blockAt(x - 1, y - 1)).toBe("planter");
  await expect.poll(() => blockAt(x + 1, y - 1)).toBe("kitchen");
  await page.click("#build");

  // Tap the planter: plant herbs.
  await tapTile(page, -1, -1);
  const sheet = page.locator(".workshop-sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator(".workshop-row", { hasText: "Bunch of herbs" }).locator("button").click();
  await expect
    .poll(async () => (await (await page.request.get("/v1/world")).json()).crops ?? [])
    .toContainEqual(expect.objectContaining({ x: x - 1, y: y - 1, crop: "herb" }));
  await page.screenshot({ path: "test-results/make-planted.png" });

  // Two days on, the herbs are ready to pick.
  for (let d = 0; d < 2; d++)
    expect((await page.request.post("/v1/test/advance-day")).ok()).toBe(true);
  await page.reload();
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, -1, -1);
  await expect(sheet).toContainText("Ready to pick");
  await page.screenshot({ path: "test-results/make-ready.png" });
  await sheet.getByRole("button", { name: "Harvest" }).click();
  await expect
    .poll(async () => (await inventory(page.request, fern.token)).stacks)
    .toContainEqual({ kind: "herb", count: 3 });

  // Tap the kitchen: make herb tea with a label.
  await tapTile(page, 1, -1);
  await expect(sheet).toBeVisible();
  await page.fill("#workshop-label", "Calm");
  await sheet.locator(".workshop-row", { hasText: "Herb tea" }).locator("button").click();
  await expect
    .poll(async () => (await inventory(page.request, fern.token)).goods)
    .toContainEqual(expect.objectContaining({ kind: "herb_tea", label: "Calm" }));

  // Your things, from the kitchen's sheet: one tap closes it and lands on the page.
  await tapTile(page, 1, -1);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "All your things" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(sheet).toBeHidden();
  // The tea, signed by Fern.
  const tea = page.locator(".things-good", { hasText: "Herb tea" });
  await expect(tea).toContainText("“Calm”");
  await expect(tea).toContainText("Fern");
  await page.screenshot({ path: "test-results/make-things.png" });

  // Give it to Olive from her profile.
  await page.goto(`/r/${olive.id}`);
  await page.locator("#thing-open").click();
  await expect(page.locator("#thing-pick option").first()).toHaveText("Herb tea “Calm”");
  await page.locator("#thing-note").fill("for slow mornings");
  await page.locator("#thing-form button[type=submit]").click();
  await expect(page.locator("#site-toast")).toContainText("You gave Olive a gift");
  const got = await inventory(page.request, olive.token);
  expect(got.goods).toEqual([
    expect.objectContaining({ kind: "herb_tea", label: "Calm", makerId: fern.id }),
  ]);
  await page.screenshot({ path: "test-results/make-gave.png" });

  // Olive would rather not keep it: she sends it back from her things, and it's Fern's again.
  await signIn(page, olive);
  await page.goto("/inventory");
  const gift = page.locator(".things-gift", { hasText: "Herb tea" });
  await expect(gift).toContainText("From");
  await expect(gift).toContainText("Fern");
  await expect(gift).toContainText("send it back for 6 more days");
  await page.screenshot({ path: "test-results/make-gift.png" });
  const back = gift.locator("button");
  await expect(back).toHaveText("Send back");
  await back.click();
  await expect(back).toHaveText("Send it back?");
  await back.click();
  await expect(page.locator("#site-toast")).toContainText("Sent back to Fern");
  await expect(page.locator(".things-gift")).toHaveCount(0);
  expect((await inventory(page.request, olive.token)).goods).toEqual([]);
  expect((await inventory(page.request, fern.token)).goods).toContainEqual(
    expect.objectContaining({ kind: "herb_tea", label: "Calm" }),
  );

  expect(errors).toEqual([]);
});

test("make a piece of art and put it on a pedestal", async ({ page }) => {
  const errors = watchErrors(page);
  const iris = await settler(page.request, "Iris");
  await signIn(page, iris);

  // On her things page, a picture of hers becomes a piece of art with a title.
  await page.goto("/inventory");
  await page
    .locator("#piece-file")
    .setInputFiles({ name: "garden.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(page.locator("#piece-status")).toHaveText("Now give it a title.");
  await expect(page.locator(".piece-preview img.thing-picture")).toBeVisible();
  await page.locator("#piece-title").fill("Clay sky");
  await page.locator("#piece-make").click();
  await expect(page.locator("#site-toast")).toContainText("You made a piece of art");
  const art = page.locator(".things-good", { hasText: "Clay sky" });
  await expect(art.locator("img.thing-picture")).toBeVisible();
  await page.screenshot({ path: "test-results/show-piece.png" });
  const [piece] = (await inventory(page.request, iris.token)).goods;
  expect(piece).toMatchObject({ kind: "piece", label: "Clay sky", makerId: iris.id });

  // In the world: a pedestal up and to the left of her hearth, then tap it to put the piece up.
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await page.click("#build");
  await page.click('[data-block="pedestal"]');
  await tapTile(page, -1, -1);
  await page.click("#build");
  const world = async () => (await page.request.get("/v1/world")).json();
  const me = (await world()).residents.find((r: { id: string }) => r.id === iris.id);
  await expect
    .poll(async () => (await world()).blocks)
    .toContainEqual({ x: me.x - 1, y: me.y - 1, block: "pedestal" });
  await tapTile(page, -1, -1);
  const sheet = page.locator(".display-sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator(".workshop-row", { hasText: "Clay sky" }).getByRole("button").click();
  await expect
    .poll(async () => (await world()).displays ?? [])
    .toContainEqual(
      expect.objectContaining({
        x: me.x - 1,
        y: me.y - 1,
        by: iris.id,
        good: expect.objectContaining({ id: piece.id }),
      }),
    );
  await page.screenshot({ path: "test-results/show-displayed.png" });

  // A neighbor admires it from wherever they are. Tapping it again shows it large, with its
  // maker and how often it was admired, and lets Iris take it down. She can't admire her own.
  const juno = await join(page.request, "Juno");
  const at = { x: me.x - 1, y: me.y - 1 };
  expect((await act(page.request, juno.token, { type: "admire", ...at })).ok).toBe(true);
  await tapTile(page, -1, -1);
  await expect(sheet.locator(".showcase-name")).toHaveText("Piece of art “Clay sky”");
  await expect(sheet.locator(".showcase-line")).toHaveText(["Made by Iris", "Admired once"]);
  await expect(sheet.locator("#display-admire")).toHaveCount(0);
  await page.screenshot({ path: "test-results/show-sheet.png" });
  await sheet.getByRole("button", { name: "Take down" }).click();
  await expect.poll(async () => (await world()).displays).toBeUndefined();
  expect((await inventory(page.request, iris.token)).goods).toContainEqual(
    expect.objectContaining({ id: piece.id }),
  );

  expect(errors).toEqual([]);
});
