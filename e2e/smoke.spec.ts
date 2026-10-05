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
  await page.click("#join-color button[data-value=plum]");
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
  // The world says so, once the claim reaches this page too. Build waits for that.
  await expect(page.locator("#toast")).toContainText("This plot is yours");

  await page.click("#build");
  await page.click('[data-block="stone"]');
  const { vp, scale } = await tileSize(page);
  await settleCamera(page);
  await page.mouse.click(vp.width / 2 - scale, vp.height / 2 - scale);
  // Only our own plot: earlier tests may have built homes on the plots next door.
  const plotOf = (t: number, size: number) => Math.floor(t / size);
  await expect
    .poll(async () => {
      const w = await world();
      const size = w.config.plotSize as number;
      return w.blocks.filter(
        (b: { x: number; y: number }) =>
          plotOf(b.x, size) === plotOf(x, size) && plotOf(b.y, size) === plotOf(y, size),
      );
    })
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

test("with no plot yet, Build and Home say how to get one", async ({ page }) => {
  await page.goto("/world");
  await page.fill("#join-name", "Juno");
  await page.click("#world-join button[type=submit]");
  await expect(page.locator("#hud")).toBeVisible();

  // Nothing to build on: a plain line, not build mode and not the server's hints for agents.
  await page.click("#build");
  const toast = page.locator("#toast");
  await expect(toast).toContainText("You don't have a plot yet");
  await expect(toast).not.toContainText("px");
  await expect(page.locator("#build")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#palette")).toBeHidden();

  // Nowhere to go home to, said right away.
  await page.click("#home");
  await expect(toast).toContainText("You don't have a plot yet");
  await expect(toast).not.toContainText("settle");
});

test("a name the server refuses stays on the form and says why", async ({ page }) => {
  await page.goto("/world");
  // Official-sounding names are refused by the text filter, after the form sends it.
  await page.fill("#join-name", "Terrakin Support");
  await page.click("#world-join button[type=submit]");
  await expect(page.locator("#join-error")).not.toBeEmpty();
  await expect(page.locator("#join-error")).not.toContainText("Can't reach");
  await expect(page.locator("#join-submit-label")).toHaveText("Step inside");
  await expect(page.locator("#join-name")).toBeFocused();
  await expect(page.locator("#join-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#hud")).toBeHidden();
});

test("a saved key the server doesn't know comes back to the landing with a way out", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("terrakin.token", "not-a-real-key");
    localStorage.setItem("terrakin.resident", "r_0000000000000000");
  });
  await page.goto("/world");
  await expect(page.locator("#join-error")).toContainText("We couldn't find your character");
  await expect(page.locator("#restore")).toHaveAttribute("open", "");
  await expect(page.locator("#hud")).toBeHidden();
  await expect(page.locator("#world-join button[type=submit]")).toBeEnabled();
});

test("the landing form never puts a key, name, or note in the address bar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/world");
  // The fields have no names, so even a native submit couldn't send them.
  for (const id of ["join-name", "join-note", "restore-key"]) {
    expect(await page.locator(`#${id}`).getAttribute("name")).toBeNull();
  }
  await page.locator("#restore summary").click();
  await page.fill("#restore-key", "not-a-real-key");
  await page.press("#restore-key", "Enter");
  await expect(page.locator("#restore-error")).toContainText("doesn't open any character");
  await page.fill("#join-note", "Loves lemons");
  await page.press("#join-note", "Enter");
  await expect(page.locator("#join-error")).toContainText("Pick a name first");
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});
