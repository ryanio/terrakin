import { expect, type Page, test } from "@playwright/test";
import { act, freePlots, join, persona, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Building with what you gather (RFC 0016) on a phone: a resident settles a plot where branches lie
 * today, picks up three and makes a table at a workbench over the API, the way an agent would.
 * Then, in the world's build bar, they lay a dirt path from the Paths tab and place the table
 * from the Furniture tab, and the world shows both. Then a neighbor with a hut builds up (RFC
 * 0028): an upstairs added from the build bar after a second tap, stairs, a loft's flooring laid with
 * Upstairs picked, and Go up beside her on the stairs, with the picker following her up, then a
 * gable roof of wood put on from the bar's Roof chip (RFC 0041). Before that, her hut's door
 * (decision 0349): drawn on the map, walked through, and hung again from the Blocks tab.
 */

interface Tile {
  x: number;
  y: number;
}
type Pickup = Tile & { kind: string };
const STEP = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] } as const;

/**
 * How much of the middle of the tile `dy` south of you the map paints in a door's red, from 0 to 1:
 * the panel `paintDoor` draws. A pixel counts by its hue, red well ahead of green and green near
 * blue, never by how strong the red is: the weather follows the real hour, and a cloudy or foggy
 * wash takes the strength out of every color. Wood, fallen leaves, and grass have green well
 * above blue, so none of them counts.
 */
function doorRed(page: Page, dy: number): Promise<number> {
  return page.evaluate((dy) => {
    const canvas = document.getElementById("world") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const dpr = canvas.width / window.innerWidth;
    const scale = Math.max(16, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 13));
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2 + dy * scale + scale * 0.1;
    const w = Math.round(scale * 0.2 * dpr);
    const h = Math.round(scale * 0.3 * dpr);
    const { data } = ctx.getImageData(
      Math.round(cx * dpr - w / 2),
      Math.round(cy * dpr - h / 2),
      w,
      h,
    );
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      if (r > 110 && r - g > 50 && r - g > 3 * (g - b)) red++;
    }
    return red / (w * h);
  }, dy);
}

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
  const wren = await join(page.request, "Bracken");
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

  // Building up (RFC 0028): a neighbor with a hut, coins, and wood.
  const bramble = await persona(page.request, "stocked", { name: "Bramble" });
  const where = async (): Promise<(Tile & { floor?: number }) | undefined> =>
    (await (await page.request.get("/v1/world")).json()).residents.find(
      (r: { id: string }) => r.id === bramble.id,
    );

  await test.step("see her hut's door on the map, walk out through it, and hang it again from the Blocks tab", async () => {
    // She stands on her hearth, in the middle of the hut, its door two tiles south (decision 0349).
    const start = await where();
    if (!start) throw new Error("Bramble isn't in the world");
    const door = { x: start.x, y: start.y + 2 };
    const blocks = async () => (await (await page.request.get("/v1/world")).json()).blocks;
    expect(await blocks()).toContainEqual({ ...door, block: "door" });
    await signIn(page, bramble);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#world-loader")).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => doorRed(page, 2)).toBeGreaterThan(0.3);
    // A tap past the door walks her out through it, and one back walks her home.
    await tapTile(page, 0, 3);
    await expect.poll(where).toMatchObject({ x: start.x, y: start.y + 3 });
    await tapTile(page, 0, -3);
    await expect.poll(where).toMatchObject({ x: start.x, y: start.y });
    // In the build bar a tap takes the door down, and with Door picked the next hangs it again.
    await page.click("#build");
    await page.click('[data-block="door"]');
    await expect(page.locator("#palette-line")).toContainText("Door: free.");
    await tapTile(page, 0, 2);
    await expect.poll(blocks).not.toContainEqual({ ...door, block: "door" });
    await tapTile(page, 0, 2);
    await expect.poll(blocks).toContainEqual({ ...door, block: "door" });
    await page.click("#build");
  });

  await test.step("add an upstairs for coins after a second tap, and put up stairs inside the hut", async () => {
    // She stands on her hearth, in the middle of the hut.
    const start = await where();
    if (!start) throw new Error("Bramble isn't in the world");
    await page.click("#build");
    const add = page.locator("#add-floor");
    await expect(add).toHaveText("Add an upstairs, 200 coins");
    await add.click();
    await expect(add).toHaveText("Tap again to spend 200 coins");
    await add.click();
    const ground = page.getByRole("button", { name: "Ground floor" });
    const upstairs = page.getByRole("button", { name: "Upstairs" });
    await expect(ground).toHaveAttribute("aria-pressed", "true");
    await expect(upstairs).toHaveAttribute("aria-pressed", "false");
    // The picker grows to its full height a frame after it appears, so ask until it has.
    await expect
      .poll(async () => (await upstairs.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    // Stairs on the tile north of her hearth, from the Blocks tab.
    await page.click('[data-block="stairs"]');
    await expect(page.locator("#palette-line")).toContainText("Stairs: 4 wood");
    await tapTile(page, 0, -1);
    await expect
      .poll(async () => (await (await page.request.get("/v1/world")).json()).blocks)
      .toContainEqual({ x: start.x, y: start.y - 1, block: "stairs" });
  });

  await test.step("pick Upstairs and lay a loft's flooring, then go up the stairs and see the picker follow", async () => {
    const start = await where();
    if (!start) throw new Error("Bramble isn't in the world");
    await page.getByRole("button", { name: "Upstairs" }).click();
    await page.getByRole("tab", { name: "Paths" }).click();
    await page.click('[data-ground="planks"]');
    await tapTile(page, 0, -2);
    await expect
      .poll(async () => (await (await page.request.get("/v1/world")).json()).ground ?? [])
      .toContainEqual({ x: start.x, y: start.y - 2, floor: 1, ground: "planks" });
    // Out of the build bar, a tap on the stairs walks her onto them, and Go up shows beside her.
    await page.click("#build");
    await tapTile(page, 0, -1);
    const climb = page.locator("#world-climb");
    await expect(climb).toHaveText("Go up");
    await climb.click();
    await expect.poll(async () => (await where())?.floor).toBe(1);
    await expect(climb).toHaveText("Go down");
    await page.click("#build");
    await expect(page.getByRole("button", { name: "Upstairs" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  await test.step("put a gable roof of wood on the home from the build bar's Roof chip", async () => {
    const roof = page.locator("#palette-roof");
    await expect(roof).toHaveText("Roof");
    await roof.click();
    const sheet = page.locator(".roof-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Gable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sheet.locator("#roof-set").click();
    await expect(sheet).toBeHidden();
    // The world took it, and the chip reads the roof the mirror now has.
    await expect
      .poll(async () => {
        const world = await (await page.request.get("/v1/world")).json();
        return world.plots.find((p: { roof?: unknown }) => p.roof)?.roof;
      })
      .toEqual({ style: "gable", material: "wood" });
    await expect(roof).toHaveText("Roof: gable");
  });

  expect(errors).toEqual([]);
});
