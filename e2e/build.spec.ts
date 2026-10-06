import { expect, test } from "@playwright/test";
import { act, freePlots, join, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Building with what you gather (RFC 0016) on a phone: a resident settles a plot where branches lie
 * today, picks up three and makes a table at a workbench over the API, the way an agent would.
 * Then, in the world's build bar, they lay a dirt path from the Paths tab and place the table
 * from the Furniture tab, and the world shows both.
 */

interface Tile {
  x: number;
  y: number;
}
type Pickup = Tile & { kind: string };
const STEP = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] } as const;

test("lay a path and place a table you made, from the build bar's tabs", async ({ page }) => {
  const errors = watchErrors(page);
  const world = await (await page.request.get("/v1/world")).json();
  const { reach, plotSize: S } = world.config;
  const inPlot = (t: Tile, px: number, py: number) =>
    Math.floor(t.x / S) === px && Math.floor(t.y / S) === py;
  const branches = (px: number, py: number) =>
    (world.pickups as Pickup[]).filter((p) => p.kind === "wood" && inPlot(p, px, py));

  // A free plot with three branches lying on it today: enough wood for a table.
  const plots = (await freePlots(page.request, 60, "top-right"))
    .map(([px, py]) => ({ px, py, wood: branches(px, py) }))
    .filter((p) => p.wood.length >= 3)
    .sort((a, b) => b.wood.length - a.wood.length);
  const wren = await join(page.request, "Wren");
  let home: (typeof plots)[number] | undefined;
  for (const p of plots.slice(0, 5)) {
    if ((await act(page.request, wren.token, { type: "settle", px: p.px, py: p.py })).ok) {
      home = p;
      break;
    }
  }
  if (!home) throw new Error("No free plot with three branches in the test world today");
  const settled = home;

  const me = async (): Promise<Tile> =>
    (await (await page.request.get("/v1/world")).json()).residents.find(
      (r: { id: string }) => r.id === wren.id,
    );

  await test.step("gather three branches and make a table at a workbench, over the API", async () => {
    for (const branch of settled.wood.slice(0, 3)) {
      // Walk until it's within reach, a step at a time, the way an agent would.
      for (
        let at = await me();
        Math.max(Math.abs(branch.x - at.x), Math.abs(branch.y - at.y)) > reach;
        at = await me()
      ) {
        const dir =
          Math.abs(branch.x - at.x) > reach
            ? branch.x > at.x
              ? "e"
              : "w"
            : branch.y > at.y
              ? "s"
              : "n";
        expect((await act(page.request, wren.token, { type: "move", dir })).ok).toBe(true);
      }
      expect((await act(page.request, wren.token, { type: "gather", ...branch })).ok).toBe(true);
    }
    // A workbench beside her, then a table from the three branches.
    const at = await me();
    const bench = Object.values(STEP)
      .map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
      .find((t) => inPlot(t, settled.px, settled.py));
    if (!bench) throw new Error("No tile beside her on her plot");
    expect(
      (await act(page.request, wren.token, { type: "place", ...bench, block: "workbench" })).ok,
    ).toBe(true);
    const made = await act(page.request, wren.token, { type: "craft", recipe: "table", ...bench });
    expect(made.ok).toBe(true);
    const things = await read(page.request, wren.token, "/v1/inventory");
    expect(things.inventory.stacks).toContainEqual({ kind: "table", count: 1 });
  });

  await test.step("lay a dirt path from the Paths tab, and place the table from the Furniture tab", async () => {
    const at = await me();
    const now = await (await page.request.get("/v1/world")).json();
    const taken = new Set<string>([
      ...now.blocks.map((b: Tile) => `${b.x},${b.y}`),
      ...now.residents
        .filter((r: { online: boolean }) => r.online)
        .map((r: Tile) => `${r.x},${r.y}`),
    ]);
    // Two open tiles beside her on her plot: one for the path, one for the table.
    const open = Object.values(STEP)
      .map(([dx, dy]) => ({ dx, dy, x: at.x + dx, y: at.y + dy }))
      .filter((t) => inPlot(t, settled.px, settled.py) && !taken.has(`${t.x},${t.y}`));
    const [path, spot] = open;
    if (!path || !spot) throw new Error("Not two open tiles beside her");

    await signIn(page, wren);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await page.click("#build");
    const palette = page.locator("#palette");
    await expect(palette).toBeVisible();
    // The bar stays on the phone's screen with its tabs.
    const box = await palette.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);

    await page.getByRole("tab", { name: "Paths" }).click();
    await page.click('[data-ground="dirt"]');
    await expect(page.locator("#palette-line")).toContainText("Dirt path: free");
    // Cobblestones take stone she doesn't have: the line says so, and the tile is left alone.
    await page.click('[data-ground="cobble"]');
    await expect(page.locator("#palette-line")).toContainText("You need 1 stone more");
    await page.click('[data-ground="dirt"]');
    await tapTile(page, path.dx, path.dy);
    await expect
      .poll(async () => (await (await page.request.get("/v1/world")).json()).ground ?? [])
      .toContainEqual({ x: path.x, y: path.y, ground: "dirt" });

    await page.getByRole("tab", { name: "Furniture" }).click();
    await page.click('[data-block="table"]');
    await expect(page.locator("#palette-line")).toHaveText("Table: 1 left.");
    await tapTile(page, spot.dx, spot.dy);
    await expect
      .poll(async () => (await (await page.request.get("/v1/world")).json()).blocks)
      .toContainEqual({ x: spot.x, y: spot.y, block: "table" });
    // Her last table: the bar says none are left, and where to make one.
    await expect(page.locator("#palette-line")).toContainText("Table: none yet.");
    await page.screenshot({ path: "test-results/build-bar.png" });
  });

  expect(errors).toEqual([]);
});
