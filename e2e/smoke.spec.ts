import { expect, test } from "@playwright/test";
import {
  join,
  openMoveIn,
  SMOKE_STEPS,
  skipPasskey,
  standingAt,
  tapTile,
  watchErrors,
} from "./support";

// Default world: spawn (36,36) is inside the Commons (tiles 32..39), so SMOKE_STEPS (5) steps west
// and north reach plot (3,3), which `freePlots` never hands another spec (`walkedOnto`). See
// docs/knowledge/learnings/2026-10-02-leaving-the-commons-from-spawn.md.

test("a human can join, claim, build, and chat safely next to an agent", async ({ page }) => {
  const errors = watchErrors(page, { console: "none" });

  // An agent moves in through the API, the way a muse would.
  const agent = await (
    await page.request.post("/v1/session", {
      data: { name: "Wren", kind: "agent", color: "leaf", note: "a muse who loves gardens" },
    })
  ).json();
  expect(agent.token).toBeTruthy();

  // The world lives at /world; / is the feed. Someone with no character walks it as a guest
  // first (decision 0380), on this screen only, with Move in in Claim plot's place.
  await page.goto("/world");
  await test.step("a guest sees only walking, Move in, and the way back to the feed", async () => {
    await expect(page.locator("#hud")).toHaveAttribute("data-guest", "");
    await expect(page.locator("#world-join")).toBeHidden();
    await expect(page.locator(".dpad")).toBeVisible();
    await expect(page.locator("#claim")).toHaveText("Move in");
    await expect(page.locator("#hud-feed")).toBeVisible();
    for (const id of ["chat-toggle", "build", "home", "hud-invite", "sound", "world-mode"])
      await expect(page.locator(`#${id}`)).toBeHidden();
  });

  // Nothing a guest does reaches the server, so where she stands is the page's word.
  const at = () => standingAt(page);
  await expect.poll(async () => (await at()).x).toBeGreaterThan(0);
  const spawn = await at();

  await test.step("taps walk a guest around the Town Hall, never across it", async () => {
    type Tile = { x: number; y: number };
    const { townHall, residents, pickups } = await page.request
      .get("/v1/world")
      .then((r) => r.json());
    const onHall = (t: Tile) => townHall.some((h: Tile) => h.x === t.x && h.y === t.y);
    // Each stop is the first of its tiles with nobody standing on it (Wren stands on spawn) and
    // nothing lying there.
    const free = (...tiles: Tile[]) =>
      tiles.find(
        (t) =>
          !residents.some(
            (r: Tile & { online: boolean }) => r.online && r.x === t.x && r.y === t.y,
          ) && !(pickups ?? []).some((p: Tile) => p.x === t.x && p.y === t.y),
      ) ?? (tiles[0] as Tile);
    // From the hall's west end across to its east end, the straight way is through it, and the
    // way round goes north of the hall or south through the Commons.
    const row = spawn.y - 4;
    const west = free({ x: spawn.x - 2, y: row }, { x: spawn.x - 3, y: row });
    const east = free({ x: spawn.x + 2, y: row }, { x: spawn.x + 3, y: row });
    const down = free({ x: east.x, y: spawn.y - 1 }, { x: east.x, y: spawn.y + 1 });
    const along = free({ x: spawn.x - 1, y: down.y }, { x: spawn.x - 2, y: down.y });
    const back = free({ x: along.x, y: spawn.y }, { x: along.x, y: spawn.y + 1 });
    expect(onHall({ x: spawn.x, y: row })).toBe(true);
    const seen: Tile[] = [];
    let from = { x: spawn.x, y: spawn.y };
    for (const to of [west, east, down, along, back]) {
      await tapTile(page, to.x - from.x, to.y - from.y);
      await expect
        .poll(
          async () => {
            const r = await at();
            seen.push(r);
            return [r.x, r.y];
          },
          { intervals: [100], timeout: 10_000 },
        )
        .toEqual([to.x, to.y]);
      from = to;
    }
    expect(seen.filter(onHall)).toEqual([]);
  });

  await test.step("on a free plot, Move in says Live here, and a name makes it hers", async () => {
    // The plot nobody else claims (`walkedOnto`): SMOKE_STEPS west and north of spawn.
    const here = await at();
    await tapTile(page, spawn.x - SMOKE_STEPS - here.x, spawn.y - SMOKE_STEPS - here.y);
    await expect
      .poll(async () => {
        const r = await at();
        return [r.x, r.y];
      })
      .toEqual([spawn.x - SMOKE_STEPS, spawn.y - SMOKE_STEPS]);
    await expect(page.locator("#claim")).toHaveText("Live here");
    await page.click("#claim");
    // A name is all the card asks for, and one is already in it: the look stays folded away.
    await expect(page.locator("#join-name")).not.toHaveValue("");
    await expect(page.locator("#join-look")).not.toHaveAttribute("open", "");
    await page.fill("#join-name", "Ada");
    await page.click("#world-join button[type=submit]");
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
  const world = () => page.request.get("/v1/world").then((r) => r.json());
  await expect
    .poll(async () => (await world()).plots.some((p: { ownerId: string }) => p.ownerId === id))
    .toBe(true);
  const xy = (r: { x: number; y: number }) => [r.x, r.y];
  const start = await me();
  const { x, y } = start;
  const size = (await world()).config.plotSize as number;
  expect([Math.floor(x / size), Math.floor(y / size)]).toEqual([
    Math.floor((spawn.x - SMOKE_STEPS) / size),
    Math.floor((spawn.y - SMOKE_STEPS) / size),
  ]);

  await test.step("the home sheet comes with no picker, then the passkey sheet, and Skip", async () => {
    const home = page.getByRole("dialog", { name: "This plot is yours" });
    await expect(home).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Pick a plot" })).toHaveCount(0);
    await home.getByRole("button", { name: "I'll build it myself" }).click();
    // Decision 0378: offered on the way in, once the page is clear of the home sheet, with one
    // tap to the device's own sheet and a plain Skip. It stays away for a day.
    await expect(page.locator("#passkey-ask-title")).toHaveText(
      "Keep your character on any device",
    );
    await expect(page.locator("#passkey-ask-add")).toBeVisible();
    await skipPasskey(page);
    await expect(page.locator("#build")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-block="hearth"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#palette-line")).toContainText("your pantry arrives here");
    // One plot each: Your things takes Claim plot's place, and Home and Invite come in with it.
    await expect(page.locator("#claim")).toBeHidden();
    await expect(page.locator("#hud-things")).toBeVisible();
    await expect(page.locator("#home")).toBeVisible();
    await expect(page.locator("#hud-invite")).toBeVisible();
    await expect(page.locator("#chat-toggle")).toBeVisible();
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
    await openMoveIn(page);
    // A space becomes an underscore as it's typed, and the naming rule is said before sending.
    await page.fill("#join-name", "");
    await page.locator("#join-name").pressSequentially("Ada Lovelace");
    await expect(page.locator("#join-name")).toHaveValue("Ada_Lovelace");
    await page.fill("#join-name", "Ada!");
    await page.click("#world-join button[type=submit]");
    await expect(page.locator("#join-error")).toContainText("letters, numbers, and underscores");
    // Official-sounding names are refused by the text filter, after the form sends it.
    await page.fill("#join-name", "Terrakin_Support");
    await page.click("#world-join button[type=submit]");
    await expect(page.locator("#join-error")).not.toBeEmpty();
    await expect(page.locator("#join-error")).not.toContainText("Can't reach");
    await expect(page.locator("#join-submit-label")).toHaveText("Move in");
    await expect(page.locator("#join-name")).toBeFocused();
    await expect(page.locator("#join-name")).toHaveAttribute("aria-invalid", "true");
    // Still a guest under the card: nothing joined.
    await expect(page.locator("#hud")).toHaveAttribute("data-guest", "");
  });

  await test.step("a taken name offers free ones to tap, and a way to sign in as her", async () => {
    await join(page.request, "Marigold");
    await page.fill("#join-name", "marigold");
    await page.click("#world-join button[type=submit]");
    await expect(page.locator("#join-error")).toHaveText(
      "Someone here already goes by that name. Tap a free one below, or pick your own. If that's you, sign in with your passkey.",
    );
    // Built from the held name, so a sloppy try gets properly spelled names back (decision 0302).
    await expect(page.locator("#join-free button").first()).toHaveText("Marigold_2");
    await expect(page.locator("#join-signin")).toHaveText("Sign in with your passkey");
    await expect(page.locator("#hud")).toHaveAttribute("data-guest", "");
    // Tapping one is the whole way out of the dead end: it fills the field and clears the refusal.
    await page.locator("#join-free button").first().click();
    await expect(page.locator("#join-name")).toHaveValue("Marigold_2");
    await expect(page.locator("#join-error")).toBeEmpty();
    await expect(page.locator("#join-free")).toBeEmpty();
  });

  await test.step("Suggest a name fills an empty field and never a typed one", async () => {
    const suggest = page.locator("#join-name-suggest");
    // The field holds the free name tapped above, a name someone picked: it stays.
    await expect(suggest).toBeDisabled();
    await page.fill("#join-name", "");
    await suggest.click();
    const idea = await page.locator("#join-name").inputValue();
    expect(idea).toMatch(/^[A-Z][a-z]+$/);
    await expect(suggest).toHaveText("Another");
    await expect(suggest).toHaveAccessibleName("Another name");
    await suggest.click();
    await expect(page.locator("#join-name")).not.toHaveValue(idea);
    await page.fill("#join-name", "Heyday");
    await expect(suggest).toBeDisabled();
  });

  await test.step("no key, name, or note ever reaches the address bar", async () => {
    await openMoveIn(page);
    // The fields have no names, so even a native submit couldn't send them.
    for (const id of ["join-name", "join-note", "restore-key"]) {
      expect(await page.locator(`#${id}`).getAttribute("name")).toBeNull();
    }
    await page.locator("#restore summary").click();
    await page.fill("#restore-key", "not-a-real-key");
    await page.press("#restore-key", "Enter");
    await expect(page.locator("#restore-error")).toContainText("doesn't open any character");
    await page.fill("#join-name", "");
    await page.locator("#join-look summary").click();
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
