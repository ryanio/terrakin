import { expect, type Page, test } from "@playwright/test";

// Default world: spawn (36,36) is inside the Commons (tiles 32..39), so 5 steps west and north
// reach plot (3,3). See docs/knowledge/learnings/2026-10-02-leaving-the-commons-from-spawn.md.

async function tileSize(page: Page) {
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  return { vp, scale: Math.max(16, Math.floor(Math.min(vp.width, vp.height) / 13)) };
}

/**
 * The camera eases toward the player (20% per frame). Taps below assume it's centered, so wait
 * enough frames for it to land: 0.8^40 is under a thousandth of a tile.
 */
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

test("a human can join, claim, build, and chat safely next to an agent", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // An agent moves in through the API, the way a muse would.
  const agent = await (
    await page.request.post("/v1/session", {
      data: { name: "Wren", kind: "agent", color: "leaf", note: "a muse who loves gardens" },
    })
  ).json();
  expect(agent.token).toBeTruthy();

  // The world lives at /world; / is the feed.
  await page.goto("/world");
  await page.fill("#join-name", "Ada");
  await page.click("#join-color button[aria-label=plum]");
  await page.click("#world-join button[type=submit]");
  await expect(page.locator("#hud")).toBeVisible();

  const me = async () => {
    const world = await page.request.get("/v1/world").then((r) => r.json());
    return world.residents.find((r: { name: string }) => r.name === "Ada");
  };
  // Watch our own position rather than the world's event count: other tests may join meanwhile.
  // Everything below is relative to where we started, so a moved spawn doesn't break the test.
  await expect.poll(async () => (await me()) !== undefined).toBe(true);
  const start = await me();
  const x = start.x - 5;
  const y = start.y - 5;
  for (let i = 0; i < 5; i++) {
    await page.click('[data-dir="w"]');
    await page.click('[data-dir="n"]');
  }
  await expect.poll(async () => [(await me()).x, (await me()).y]).toEqual([x, y]);

  // Other tests settle plots in the same world, so look for ours rather than counting.
  const world = () => page.request.get("/v1/world").then((r) => r.json());
  await page.click("#claim");
  await expect
    .poll(async () =>
      (await world()).plots.some((p: { ownerId: string }) => p.ownerId === start.id),
    )
    .toBe(true);

  await page.click("#build");
  await page.click('[data-block="stone"]');
  const { vp, scale } = await tileSize(page);
  await settleCamera(page);
  await page.mouse.click(vp.width / 2 - scale, vp.height / 2 - scale);
  await expect
    .poll(async () =>
      (await world()).blocks.filter(
        (b: { x: number; y: number }) => Math.abs(b.x - x) <= 3 && Math.abs(b.y - y) <= 3,
      ),
    )
    .toEqual([{ x: x - 1, y: y - 1, block: "stone" }]);

  // Set a hearth where we stand, step away, and come home.
  await page.click('[data-block="hearth"]');
  await settleCamera(page);
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await expect.poll(async () => (await me()).hearth).toEqual({ x, y });
  await page.click('[data-dir="e"]');
  await expect.poll(async () => (await me()).x).toBe(x + 1);
  await page.click("#home");
  await expect.poll(async () => [(await me()).x, (await me()).y]).toEqual([x, y]);
  await page.screenshot({ path: "test-results/hearth.png" });

  // Chat that looks like HTML must render as text.
  await page.click("#chat-toggle");
  await page.fill("#chat-input", "<img src=x onerror=alert(1)> hi");
  await page.click('#chat-form button[type="submit"]');
  await expect(page.locator("#chat-log li")).toContainText("<img src=x onerror=alert(1)> hi");
  await expect(page.locator("#chat-log img")).toHaveCount(0);

  // The agent's chat arrives too, still as plain text.
  await page.request.post("/v1/actions", {
    headers: { authorization: `Bearer ${agent.token}` },
    data: { type: "chat", text: "hello neighbor" },
  });
  await expect(page.locator("#chat-log")).toContainText("Wren ⚙ hello neighbor");

  expect(errors).toEqual([]);
});
