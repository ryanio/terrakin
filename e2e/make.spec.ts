import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * Growing, making, and giving (RFC 0005) on a phone: a resident taps a planter in the world and
 * plants herbs, comes back two days later to pick them, makes herb tea at a kitchen with a label,
 * finds it on their things page, and gives it to a friend from the friend's profile. Runs after
 * coins.spec.ts, since it moves the shared clock on.
 */

async function join(request: APIRequestContext, name: string) {
  const res = await request.post("/v1/session", { data: { name, kind: "human" } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { id: body.residentId as string, token: body.token as string };
}

async function act(request: APIRequestContext, token: string, action: unknown) {
  const res = await request.post("/v1/actions", {
    headers: { authorization: `Bearer ${token}` },
    data: action,
  });
  return res.json();
}

async function inventory(request: APIRequestContext, token: string) {
  const res = await request.get("/v1/inventory", { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()).inventory;
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

/** Unclaimed plots, read from the shared world (other specs settle too), skipping the Commons. */
async function freePlots(request: APIRequestContext, n: number): Promise<[number, number][]> {
  const world = await (await request.get("/v1/world")).json();
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p: { px: number; py: number }) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  const out: [number, number][] = [];
  for (let py = height / plotSize - 1; py >= 0 && out.length < n; py--) {
    for (let px = width / plotSize - 1; px >= 0 && out.length < n; px--) {
      if (!taken.has(`${px},${py}`)) out.push([px, py]);
    }
  }
  return out;
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

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
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

  // Your things: the tea, signed by Fern.
  await page.goto("/inventory");
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

  expect(errors).toEqual([]);
});
