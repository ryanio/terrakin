import { expect, test } from "@playwright/test";
import { join, tapTile, watchErrors } from "./support";

// Default world: spawn (36,36) is inside the Commons (tiles 32..39), so 5 steps west and north
// reach plot (3,3). See docs/knowledge/learnings/2026-10-02-leaving-the-commons-from-spawn.md.

test("a human can join, claim, build, and chat safely next to an agent", async ({ page }) => {
  const errors = watchErrors(page, { console: "none" });

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

  await test.step("with no plot yet, Build and Home say how to get one", async () => {
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

  // Other specs may join an Ada too, so find ours by the id the page saved.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terrakin.resident")))
    .toMatch(/^r_/);
  const id = await page.evaluate(() => localStorage.getItem("terrakin.resident"));
  const me = async () => {
    const world = await page.request.get("/v1/world").then((r) => r.json());
    return world.residents.find((r: { id: string }) => r.id === id);
  };
  // Watch our own position rather than the world's event count: other tests may join meanwhile.
  // Everything below is relative to where we started, so a moved spawn doesn't break the test.
  await expect.poll(async () => (await me()) !== undefined).toBe(true);

  await test.step("taps walk around the Town Hall, never across it", async () => {
    type Tile = { x: number; y: number };
    const { townHall, residents, pickups } = await page.request
      .get("/v1/world")
      .then((r) => r.json());
    const onHall = (t: Tile) => townHall.some((h: Tile) => h.x === t.x && h.y === t.y);
    // A tap on someone says who they are instead of walking there (Wren stands on spawn), and a
    // tap on something lying within reach picks it up, so each stop is the first of its tiles
    // with neither.
    const free = (...tiles: Tile[]) =>
      tiles.find(
        (t) =>
          !residents.some(
            (r: Tile & { online: boolean }) => r.online && r.x === t.x && r.y === t.y,
          ) && !(pickups ?? []).some((p: Tile) => p.x === t.x && p.y === t.y),
      ) ?? (tiles[0] as Tile);
    // From the hall's west end across to its east end, the straight way is through it, and the
    // way round goes north of the hall or south through the Commons.
    const spawn = await me();
    const row = spawn.y - 4;
    const west = free({ x: spawn.x - 2, y: row }, { x: spawn.x - 3, y: row });
    const east = free({ x: spawn.x + 2, y: row }, { x: spawn.x + 3, y: row });
    // Back beside spawn: straight down, along the row, and straight down again, since a tap
    // down and to the left lands on the 3D view button or the ones above it (Pat, Gather all).
    // Down stops two rows clear of the hall, so its "Town Hall" button is gone before the tap west.
    const down = free({ x: east.x, y: spawn.y - 1 }, { x: east.x, y: spawn.y + 1 });
    const along = free({ x: spawn.x - 1, y: down.y }, { x: spawn.x - 2, y: down.y });
    const back = free({ x: along.x, y: spawn.y }, { x: along.x, y: spawn.y + 1 });
    expect(onHall({ x: spawn.x, y: row })).toBe(true);
    const seen: { x: number; y: number }[] = [];
    let at = { x: spawn.x, y: spawn.y };
    for (const to of [west, east, down, along, back]) {
      await tapTile(page, to.x - at.x, to.y - at.y);
      await expect
        .poll(
          async () => {
            const r = await me();
            seen.push({ x: r.x, y: r.y });
            return [r.x, r.y];
          },
          { intervals: [100], timeout: 10_000 },
        )
        .toEqual([to.x, to.y]);
      at = to;
      // Beside the hall's west end, a button says how to go in.
      if (to === west) await expect(page.locator("#world-enter")).toHaveText("Town Hall");
    }
    expect(seen.filter(onHall)).toEqual([]);
  });

  const xy = (r: { x: number; y: number }) => [r.x, r.y];
  const start = await me();
  const x = start.x - 5;
  const y = start.y - 5;
  for (let i = 0; i < 5; i++) {
    await page.click('[data-dir="w"]');
    await page.click('[data-dir="n"]');
  }
  await expect.poll(async () => xy(await me())).toEqual([x, y]);

  // Other tests settle plots in the same world, so look for ours rather than counting.
  const world = () => page.request.get("/v1/world").then((r) => r.json());
  await page.click("#claim");
  await expect
    .poll(async () =>
      (await world()).plots.some((p: { ownerId: string }) => p.ownerId === start.id),
    )
    .toBe(true);
  await test.step("building it herself opens the build bar on the hearth, then names the plot", async () => {
    // The world offers a home once the claim reaches this page too.
    const home = page.getByRole("dialog", { name: "This plot is yours" });
    await expect(home).toBeVisible();
    await home.getByRole("button", { name: "I'll build it myself" }).click();
    const ask = page.getByRole("dialog", { name: "Name your new plot" });
    await expect(ask).toBeVisible();
    await ask.locator("#plot-name-input").fill("Ada's Stone Garden");
    await ask.locator("#plot-name-save").click();
    await expect(ask).toBeHidden();
    await expect(page.locator("#build")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-block="hearth"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#palette-line")).toContainText("your pantry arrives here");
    // One plot each: Your things takes Claim plot's place.
    await expect(page.locator("#claim")).toBeHidden();
    await expect(page.locator("#hud-things")).toBeVisible();
    await page.click("#build");
    await expect(page.locator("#visit-card-owner")).toHaveText("Ada's Stone Garden");
    await page.click("#build");
  });

  await page.click('[data-block="stone"]');
  await tapTile(page, -1, -1);
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
  await tapTile(page, 0, 0);
  await expect.poll(async () => (await me()).hearth).toEqual({ x, y });
  await page.click('[data-dir="e"]');
  await expect.poll(async () => (await me()).x).toBe(x + 1);
  await page.click("#home");
  await expect.poll(async () => xy(await me())).toEqual([x, y]);
  await page.screenshot({ path: "test-results/hearth.png" });

  await test.step("two arrow keys held together walk diagonally", async () => {
    // Both keys in one go, so a slow runner can't land them further apart than a person would.
    const both = (type: "keydown" | "keyup") =>
      page.evaluate((type) => {
        for (const key of ["ArrowDown", "ArrowRight"])
          window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
      }, type);
    await both("keydown");
    await expect.poll(async () => (await me()).x, { intervals: [100] }).toBeGreaterThan(x + 1);
    await both("keyup");
    // Every step went south-east: as far down as across.
    await expect
      .poll(async () => {
        const r = await me();
        return r.x > x + 1 && r.x - x === r.y - y;
      })
      .toBe(true);
  });

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

test("the landing form refuses a bad name, an unknown key, and never puts either in the address bar", async ({
  page,
}) => {
  const errors = watchErrors(page, { console: "none" });

  await test.step("a name the server refuses stays on the form and says why", async () => {
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

  await test.step("a taken name says so in plain words and opens Restore with a key", async () => {
    await join(page.request, "Marigold");
    await page.fill("#join-name", "marigold");
    await page.click("#world-join button[type=submit]");
    await expect(page.locator("#join-error")).toHaveText(
      "Someone here already goes by that name. Pick another, or restore your character with your key.",
    );
    await expect(page.locator("#restore")).toHaveAttribute("open", "");
    await expect(page.locator("#hud")).toBeHidden();
  });

  await test.step("no key, name, or note ever reaches the address bar", async () => {
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
  });

  await test.step("a saved key the server doesn't know comes back with a way out", async () => {
    await page.evaluate(() => {
      localStorage.setItem("terrakin.token", "not-a-real-key");
      localStorage.setItem("terrakin.resident", "r_0000000000000000");
    });
    await page.goto("/world");
    await expect(page.locator("#join-error")).toContainText("We couldn't find your character");
    await expect(page.locator("#restore")).toHaveAttribute("open", "");
    await expect(page.locator("#hud")).toBeHidden();
    await expect(page.locator("#world-join button[type=submit]")).toBeEnabled();
  });

  expect(errors).toEqual([]);
});
