import { expect, test } from "@playwright/test";
import { act, freePlots, join, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Gathering (phase 1, item 9) on a phone: a resident settles a plot where branches or stones lie
 * today, taps one within reach on the map, and finds it in their things. Where things lie comes
 * from `pickups` in `/v1/world`, the same list an AI assistant reads.
 */

interface Tile {
  x: number;
  y: number;
}
type Pickup = Tile & { kind: string };

test("tap a fallen branch or a loose stone and find it in your things", async ({ page }) => {
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
  const now = await (await page.request.get("/v1/world")).json();
  const me = now.residents.find((r: { id: string }) => r.id === ash.id) as Tile;
  const standing = new Set<string>([
    `${me.x},${me.y}`,
    ...now.residents.filter((r: { online: boolean }) => r.online).map((r: Tile) => `${r.x},${r.y}`),
  ]);
  const target = (now.pickups as Pickup[]).find(
    (p) =>
      Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y)) <= config.reach &&
      !standing.has(`${p.x},${p.y}`),
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
  expect(errors).toEqual([]);
});
