import { join as joinPath } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { act, freePlots, join, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Fishing (RFC 0023) on a phone: Wren settles a plot where branches lie today and picks up three,
 * and a neighbor who picked up two stones on theirs gives them to her. She makes a fishing rod at
 * a workbench over the API, the way an agent would, then in the world digs a pond from the build
 * bar's Blocks tab and casts with Fish until something bites. The fish is in her collection book.
 */

interface Tile {
  x: number;
  y: number;
}
type Pickup = Tile & { kind: string };
type Who = Awaited<ReturnType<typeof join>>;

/** Set FISHING_SHOTS to a directory to save screenshots of each step. */
async function shot(page: Page, name: string) {
  const dir = process.env.FISHING_SHOTS;
  if (dir) await page.screenshot({ path: joinPath(dir, `fishing-${name}.png`) });
}

const STEP = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] } as const;

test("dig a pond, make a rod, fish, and find the catch in your collection book", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const world = await (await page.request.get("/v1/world")).json();
  const { reach, plotSize: S } = world.config;
  const inPlot = (t: Tile, px: number, py: number) =>
    Math.floor(t.x / S) === px && Math.floor(t.y / S) === py;
  const lying = (kind: string, px: number, py: number) =>
    (world.pickups as Pickup[]).filter((p) => p.kind === kind && inPlot(p, px, py));
  const free = await freePlots(page.request, 80, "top-right");
  const where = async (who: Who): Promise<Tile> =>
    (await (await page.request.get("/v1/world")).json()).residents.find(
      (r: { id: string }) => r.id === who.id,
    );

  /** Settle a free plot where `n` of `kind` lie today, and pick them up, walking as an agent would. */
  const gatherOn = async (who: Who, kind: string, n: number) => {
    const plots = free
      .map(([px, py]) => ({ px, py, lie: lying(kind, px, py) }))
      .filter((p) => p.lie.length >= n)
      .sort((a, b) => b.lie.length - a.lie.length);
    let home: (typeof plots)[number] | undefined;
    for (const p of plots.slice(0, 6)) {
      if ((await act(page.request, who.token, { type: "settle", px: p.px, py: p.py })).ok) {
        home = p;
        break;
      }
    }
    if (!home)
      throw new Error(`No free plot with ${n} ${kind} lying on it in the test world today`);
    for (const t of home.lie.slice(0, n)) {
      for (
        let at = await where(who);
        Math.max(Math.abs(t.x - at.x), Math.abs(t.y - at.y)) > reach;
        at = await where(who)
      ) {
        const dir =
          Math.abs(t.x - at.x) > reach ? (t.x > at.x ? "e" : "w") : t.y > at.y ? "s" : "n";
        expect(await act(page.request, who.token, { type: "move", dir })).toMatchObject({
          ok: true,
        });
      }
      expect(await act(page.request, who.token, { type: "gather", ...t })).toMatchObject({
        ok: true,
      });
    }
    return home;
  };

  const wren = await join(page.request, "Wren");
  const ash = await join(page.request, "Ash");
  let home: { px: number; py: number } | undefined;
  let water: Tile & { dx: number; dy: number };

  await test.step("gather wood, get two stones from a neighbor, and make a rod at a workbench", async () => {
    home = await gatherOn(wren, "wood", 3);
    await gatherOn(ash, "stone", 2);
    const gift = { type: "give", item: "stone", to: wren.id, count: 2 };
    expect(await act(page.request, ash.token, gift)).toMatchObject({ ok: true });
    const at = await where(wren);
    const now = await (await page.request.get("/v1/world")).json();
    const taken = new Set<string>([
      ...now.blocks.map((b: Tile) => `${b.x},${b.y}`),
      ...now.residents
        .filter((r: { online: boolean }) => r.online)
        .map((r: Tile) => `${r.x},${r.y}`),
    ]);
    const settled = home;
    // Two open tiles beside her on her plot: one for the workbench, one for the pond.
    const open = Object.values(STEP)
      .map(([dx, dy]) => ({ dx, dy, x: at.x + dx, y: at.y + dy }))
      .filter((t) => inPlot(t, settled.px, settled.py) && !taken.has(`${t.x},${t.y}`));
    const [bench, pond] = open;
    if (!bench || !pond) throw new Error("Not two open tiles beside her");
    water = pond;
    const workbench = { type: "place", x: bench.x, y: bench.y, block: "workbench" };
    expect(await act(page.request, wren.token, workbench)).toMatchObject({ ok: true });
    const rod = { type: "craft", recipe: "fishing_rod", x: bench.x, y: bench.y };
    expect(await act(page.request, wren.token, rod)).toMatchObject({ ok: true });
    const things = (await read(page.request, wren.token, "/v1/inventory")).inventory;
    expect(things.goods).toContainEqual(expect.objectContaining({ kind: "fishing_rod" }));
    expect(things.stacks).toContainEqual({ kind: "stone", count: 2 });
  });

  await test.step("dig a pond from the build bar, and fish until something bites", async () => {
    await signIn(page, wren);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await page.click("#build");
    await page.click('[data-block="pond"]');
    await expect(page.locator("#palette-line")).toHaveText(
      "Pond: 2 stone a tile, to fish beside. You have enough.",
    );
    await tapTile(page, water.dx, water.dy);
    await expect
      .poll(async () => (await (await page.request.get("/v1/world")).json()).blocks)
      .toContainEqual({ x: water.x, y: water.y, block: "pond" });
    // Done building: Fish shows while she stands beside the water.
    await page.click("#build");
    const fish = page.locator("#world-fish");
    await expect(fish).toBeVisible();
    await shot(page, "pond");

    const catalog = await (await page.request.get("/v1/catalog")).json();
    const kinds = new Set<string>(
      catalog.kinds
        .filter((k: { category: string }) => k.category === "fish")
        .map((k: { kind: string }) => k.kind),
    );
    // What bites is the server's roll: cast until a fish comes up, ten casts at most.
    let caught: string | undefined;
    for (let cast = 1; cast <= 10 && !caught; cast++) {
      await fish.click();
      await expect
        .poll(
          async () => (await read(page.request, wren.token, "/v1/inventory")).inventory.castToday,
        )
        .toBe(cast);
      const stacks = (await read(page.request, wren.token, "/v1/inventory")).inventory.stacks;
      caught = stacks.find((s: { kind: string }) => kinds.has(s.kind))?.kind;
    }
    if (!caught) throw new Error("Ten casts and nothing bit");
    await expect(page.locator("#toast")).toContainText("You caught");
    await shot(page, "catch");

    await page.goto(`/r/${wren.id}/collection`);
    const got = page.locator(`.collection-kind.got[data-kind="${caught}"]`);
    await expect(got).toBeVisible();
    await expect(page.locator('[data-family="fish"] .collection-group-count')).toContainText(
      "1 of",
    );
    await got.scrollIntoViewIfNeeded();
    await shot(page, "collection");
  });

  expect(errors).toEqual([]);
});
