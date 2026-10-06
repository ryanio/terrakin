import { expect, test } from "@playwright/test";
import { act, freePlots, join, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Gathering (phase 1, item 9) on a phone: a resident settles a plot where branches or stones lie
 * today, taps one within reach on the map, and finds it in their things. Where things lie comes
 * from `pickups` in `/v1/world`, the same list an AI assistant reads. A pickup on someone else's
 * plot says whose it is instead. A find (RFC 0021) is picked up the same way and lands in your
 * collection book.
 */

interface Tile {
  x: number;
  y: number;
}
type Pickup = Tile & { kind: string; ownersOnly?: true };

test("tap a pickup within reach and find it in your things; on someone else's plot, hear whose it is", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const world = await (await page.request.get("/v1/world")).json();
  const { config } = world;
  const S = config.plotSize;
  const inPlot = (p: Tile, px: number, py: number) =>
    Math.floor(p.x / S) === px && Math.floor(p.y / S) === py;

  // The free plots with the most lying on them today, so one is surely within reach of the hearth.
  const plots = (await freePlots(page.request, 40, "top-right"))
    .map(([px, py]) => ({
      px,
      py,
      n: (world.pickups as Pickup[]).filter((p) => inPlot(p, px, py)).length,
    }))
    .sort((a, b) => b.n - a.n);

  await test.step("tap a fallen branch or a loose stone and find it in your things", async () => {
    const ash = await join(page.request, "Ash");
    let home: { px: number; py: number } | undefined;
    for (const p of plots.slice(0, 5)) {
      if ((await act(page.request, ash.token, { type: "settle", px: p.px, py: p.py })).ok) {
        home = p;
        break;
      }
    }
    if (!home) throw new Error("No free plot to settle in the test world");
    expect((await act(page.request, ash.token, { type: "build_starter_home" })).ok).toBe(true);

    // A pickup within reach of where Ash stands, not under anyone's feet (the list already leaves
    // out what's built on or picked). Not Ash's own tile: tapping yourself opens your plot in 3D.
    // Not on a neighbor's plot either: only its owners may gather there.
    const now = await (await page.request.get("/v1/world")).json();
    const me = now.residents.find((r: { id: string }) => r.id === ash.id) as Tile;
    const standing = new Set<string>([
      `${me.x},${me.y}`,
      ...now.residents
        .filter((r: { online: boolean }) => r.online)
        .map((r: Tile) => `${r.x},${r.y}`),
    ]);
    const settled = home;
    const target = (now.pickups as Pickup[]).find(
      (p) =>
        Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y)) <= config.reach &&
        !standing.has(`${p.x},${p.y}`) &&
        (!p.ownersOnly || inPlot(p, settled.px, settled.py)),
    );
    if (!target) throw new Error(`Nothing lies within reach of ${me.x},${me.y} today`);

    await signIn(page, ash);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await tapTile(page, target.x - me.x, target.y - me.y);
    await expect(page.locator("#toast")).toContainText("You picked up 1");
    await page.screenshot({ path: "test-results/gather-picked.png" });
    await expect
      .poll(async () => (await read(page.request, ash.token, "/v1/inventory")).inventory.stacks)
      .toContainEqual({ kind: target.kind, count: 1 });
    // Picked clean for today: everyone's world says so.
    const after = await (await page.request.get("/v1/world")).json();
    expect(after.gathered).toContainEqual({ x: target.x, y: target.y });

    // Your things list it.
    await page.goto("/inventory");
    await expect(page.locator(".things-stack", { hasText: `1 ${target.kind}` })).toBeVisible();
  });

  await test.step("a pickup on someone else's plot says whose it is instead of walking there", async () => {
    // Ash settles a plot with pickups and gives it up again, standing in the middle of it; Bo
    // settles it. Ash now stands on Bo's plot, with Bo's pickups all around.
    const ash = await join(page.request, "Ash");
    const bo = await join(page.request, "Bo");
    let plot: { px: number; py: number } | undefined;
    for (const p of plots.slice(0, 8)) {
      if (!(await act(page.request, ash.token, { type: "settle", px: p.px, py: p.py })).ok)
        continue;
      expect((await act(page.request, ash.token, { type: "release" })).ok).toBe(true);
      if ((await act(page.request, bo.token, { type: "settle", px: p.px, py: p.py })).ok) {
        plot = p;
        break;
      }
    }
    if (!plot) throw new Error("No free plot to hand from Ash to Bo in the test world");
    const theirs = plot;

    const now = await (await page.request.get("/v1/world")).json();
    expect(now.plotPickupsOwned).toBe(true);
    const me = now.residents.find((r: { id: string }) => r.id === ash.id) as Tile;
    const standing = new Set<string>(
      now.residents.filter((r: { online: boolean }) => r.online).map((r: Tile) => `${r.x},${r.y}`),
    );
    // The nearest of Bo's pickups on screen. Near or far, a tap answers the same.
    const far = (p: Tile) => Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
    const target = (now.pickups as Pickup[])
      .filter(
        (p) =>
          inPlot(p, theirs.px, theirs.py) &&
          !standing.has(`${p.x},${p.y}`) &&
          Math.abs(p.x - me.x) <= 5 &&
          Math.abs(p.y - me.y) <= 10,
      )
      .sort((a, b) => far(a) - far(b))[0];
    if (!target) throw new Error(`Nothing lies on Bo's plot near ${me.x},${me.y} today`);
    expect(target.ownersOnly).toBe(true);
    // The sim refuses it too, which an AI assistant would see.
    const refused = await act(page.request, ash.token, {
      type: "gather",
      x: target.x,
      y: target.y,
    });
    expect(refused.error?.code).toBe(
      far(target) <= world.config.reach ? "not_your_plot" : "out_of_reach",
    );

    await signIn(page, ash);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await tapTile(page, target.x - me.x, target.y - me.y);
    await expect(page.locator("#toast")).toContainText("That's Bo's plot");
    await page.screenshot({ path: "test-results/gather-not-yours.png" });
    // Ash stays put, and nothing went into Ash's things.
    await page.waitForTimeout(600);
    const after = await (await page.request.get("/v1/world")).json();
    expect(after.residents.find((r: { id: string }) => r.id === ash.id)).toMatchObject({
      x: me.x,
      y: me.y,
    });
    expect(after.pickups).toContainEqual(target);
    const things = (await read(page.request, ash.token, "/v1/inventory")).inventory;
    expect(things?.stacks ?? []).not.toContainEqual(expect.objectContaining({ kind: target.kind }));
  });

  await test.step("forage a find on the map and see it in your collection book", async () => {
    // A find lying today on a plot nobody has claimed: Fern claims that plot, so it's hers to take.
    const catalog = await (await page.request.get("/v1/catalog")).json();
    const finds = new Set<string>(
      catalog.kinds
        .filter((k: { category: string }) => k.category === "find")
        .map((k: { kind: string }) => k.kind),
    );
    const now = await (await page.request.get("/v1/world")).json();
    const claimed = new Set<string>([
      ...now.plots.map((p: { px: number; py: number }) => `${p.px},${p.py}`),
      `${now.commons.px},${now.commons.py}`,
    ]);
    const plotOf = (p: Tile) => `${Math.floor(p.x / S)},${Math.floor(p.y / S)}`;
    const lying = (now.pickups as Pickup[]).filter(
      (p) => finds.has(p.kind) && !claimed.has(plotOf(p)),
    );
    expect(now.findsOpen).toBe(true);
    const fern = await join(page.request, "Fern");
    let target: Pickup | undefined;
    for (const p of lying) {
      const [px, py] = plotOf(p).split(",").map(Number);
      if ((await act(page.request, fern.token, { type: "settle", px, py })).ok) {
        target = p;
        break;
      }
    }
    if (!target) throw new Error("No find lies on unclaimed land in the test world today");
    const find = target;
    // Walk within reach of it over the API, never onto it: tapping yourself opens your plot in 3D.
    const where = async () =>
      (
        (await (await page.request.get("/v1/world")).json()).residents as (Tile & { id: string })[]
      ).find((r) => r.id === fern.id) as Tile;
    let me = await where();
    const DIRS: Record<string, string> = {
      "0,-1": "n",
      "0,1": "s",
      "1,0": "e",
      "-1,0": "w",
      "1,-1": "ne",
      "-1,-1": "nw",
      "1,1": "se",
      "-1,1": "sw",
    };
    for (let i = 0; i < 12; i++) {
      const far = Math.max(Math.abs(find.x - me.x), Math.abs(find.y - me.y));
      if (far >= 1 && far <= config.reach) break;
      const away = far === 0 ? -1 : 1;
      const dx = Math.sign(find.x - me.x) * away || (far === 0 ? 1 : 0);
      const dy = Math.sign(find.y - me.y) * away;
      expect(
        (await act(page.request, fern.token, { type: "move", dir: DIRS[`${dx},${dy}`] })).ok,
      ).toBe(true);
      me = await where();
    }

    await signIn(page, fern);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await tapTile(page, find.x - me.x, find.y - me.y);
    await expect(page.locator("#toast")).toContainText("You found");
    await page.screenshot({ path: "test-results/forage-found.png" });
    await expect
      .poll(async () => (await read(page.request, fern.token, "/v1/inventory")).inventory.stacks)
      .toContainEqual({ kind: find.kind, count: 1 });

    // Her collection book has it, and her profile says how far along the book is.
    await page.goto(`/r/${fern.id}/collection`);
    await expect(page.locator(`.collection-kind.got[data-kind="${find.kind}"]`)).toBeVisible();
    await expect(page.locator("#collection-count")).toContainText("Collected");
    await page.screenshot({ path: "test-results/forage-collection.png", fullPage: true });
    await page.goto(`/r/${fern.id}`);
    await expect(page.locator(".profile-collected")).toContainText("Collected");
  });
  expect(errors).toEqual([]);
});
