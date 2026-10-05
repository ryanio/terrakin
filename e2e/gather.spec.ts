import { expect, test } from "@playwright/test";
import { gatherableAt } from "../sim/src/gather";
import { act, freePlots, join, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Gathering (phase 1, item 9) on a phone: a resident settles a plot where branches or stones lie
 * today, taps one within reach on the map, and finds it in their things. Where things lie comes
 * from the sim's own spawn function, the same one the client draws with.
 */

interface Tile {
  x: number;
  y: number;
}

test("tap a fallen branch or a loose stone and find it in your things", async ({ page }) => {
  const errors = watchErrors(page);
  const world = await (await page.request.get("/v1/world")).json();
  const { config, day } = world;
  const S = config.plotSize;
  const lying = (t: Tile) => gatherableAt(config, t.x, t.y, day);
  const plotTiles = (px: number, py: number) =>
    Array.from({ length: S * S }, (_, i) => ({
      x: px * S + (i % S),
      y: py * S + Math.floor(i / S),
    }));

  // The free plots with the most lying on them today, so one is surely within reach of the hearth.
  const plots = (await freePlots(page.request, 40, "top-right"))
    .map(([px, py]) => ({ px, py, n: plotTiles(px, py).filter((t) => lying(t)).length }))
    .sort((a, b) => b.n - a.n);
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

  // A pickup within reach of where Ash stands, not under a block or anyone's feet.
  const now = await (await page.request.get("/v1/world")).json();
  const me = now.residents.find((r: { id: string }) => r.id === ash.id) as Tile;
  const blocked = new Set<string>([
    ...now.blocks.map((b: Tile) => `${b.x},${b.y}`),
    ...(now.gathered ?? []).map((t: Tile) => `${t.x},${t.y}`),
    ...now.residents.filter((r: { online: boolean }) => r.online).map((r: Tile) => `${r.x},${r.y}`),
  ]);
  const near: (Tile & { kind: string })[] = [];
  for (let dy = -config.reach; dy <= config.reach; dy++) {
    for (let dx = -config.reach; dx <= config.reach; dx++) {
      const t = { x: me.x + dx, y: me.y + dy };
      const kind = lying(t);
      if (kind && !blocked.has(`${t.x},${t.y}`)) near.push({ ...t, kind });
    }
  }
  const target = near[0];
  if (!target) throw new Error(`Nothing lies within reach of ${me.x},${me.y} on day ${day}`);

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
  expect(errors).toEqual([]);
});
