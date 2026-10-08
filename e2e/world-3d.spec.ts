import { expect, test } from "@playwright/test";
import {
  act,
  countFrames,
  framesWhileIdle,
  join,
  persona,
  read,
  signIn,
  watchErrors,
} from "./support";

/**
 * The world in 3D at phone size (decision 0060): the toggle, a neighbor drawn nearby, walking by
 * tapping the 3D ground, the d-pad following the camera, the choice remembered, back to the map,
 * and nothing left drawing after leaving. WebGL runs on Chromium's SwiftShader here. Runs nightly
 * (e2e/suite.ts); every push runs the 3D smoke in `smoke-3d.spec.ts`.
 */
test("the world switches to 3D, walks by tapping, and stops drawing when you leave", async ({
  page,
}) => {
  // Every step here waits on frames drawn on the CPU, and the walk, the camera turn, two
  // toggles, and a reload don't fit a CI runner's 30 s even when this spec runs alone.
  test.slow();
  await countFrames(page);
  const errors = watchErrors(page, { console: "all" });

  // We stand on a plot of our own with nothing built (the 3D toggle comes in with a plot,
  // decision 0234), and a neighbor visits it over the API.
  const ada = await persona(page.request, { name: "Ada3d", plot: true });
  const juniper = await join(page.request, "Juniper3d", { kind: "agent", color: "plum" });
  const [px, py] = ada.plot ?? [0, 0];
  expect((await act(page.request, juniper.token, { type: "visit", px, py })).ok).toBe(true);
  await signIn(page, ada);
  const me = async () => {
    const world = await read(page.request, ada.token, "/v1/world");
    return world.residents.find((r: { id: string }) => r.id === ada.id);
  };

  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  const toggle = page.getByRole("button", { name: "3D view" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // On: the scene loads, the map steps aside, and the view names who is around.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const scene = page.locator("#world-3d");
  await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("canvas#world")).toBeHidden();
  await expect(scene).toHaveAttribute("aria-label", /Juniper3d/);
  await page.screenshot({ path: "test-results/world-3d.png" });

  // A tap on the ground to the west walks there, the same as on the map.
  const start = await me();
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  // Someone else may be standing where we tap (a tap on a resident names them), so try a few spots.
  const spots = [
    [0.12, 0.45],
    [0.12, 0.55],
    [0.2, 0.38],
  ] as const;
  let tries = 0;
  await expect(async () => {
    const [fx, fy] = spots[tries++ % spots.length] ?? [0.12, 0.45];
    await page.mouse.click(vp.width * fx, vp.height * fy);
    await expect.poll(async () => (await me()).x, { timeout: 2_000 }).toBeLessThan(start.x);
  }).toPass({ timeout: 10_000 });

  // The d-pad walks the way the camera looks. As the camera starts, up is north.
  const up = page.locator('.dpad [data-dir="n"]');
  await expect(up).toHaveAttribute("aria-label", "North");
  await expect(page.locator(".dpad")).toHaveAttribute("data-compass", "");
  // Drag across the scene to turn the camera about a quarter turn: now it looks east.
  await page.mouse.move(vp.width * 0.1, vp.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.85, vp.height * 0.45, { steps: 12 });
  await page.mouse.up();
  await expect(up).toHaveAttribute("aria-label", "East");
  await expect(page.locator('.dpad [data-dir="e"]')).toHaveAttribute("aria-label", "South");
  // Up walks east now. A step of the tap's walk may still land first, so look again if it does.
  await expect(async () => {
    const before = await me();
    await up.click();
    await expect.poll(async () => (await me()).x, { timeout: 2_000 }).toBeGreaterThan(before.x);
    expect((await me()).y).toBe(before.y);
  }).toPass({ timeout: 10_000 });

  // The choice is remembered on this device.
  await page.reload();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });

  // Off: back to the map, and the scene is gone.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(scene.locator("canvas")).toHaveCount(0);
  await expect(page.locator("canvas#world")).toBeVisible();
  // On the map, up is north again.
  await expect(up).toHaveAttribute("aria-label", "North");
  await expect(page.locator(".dpad")).not.toHaveAttribute("data-compass");

  // On again, then leave for the feed: nothing keeps drawing.
  await toggle.click();
  await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
  await page.locator("#hud-feed").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("canvas.stage-canvas")).toHaveCount(0);
  expect(await framesWhileIdle(page)).toBe(0);

  expect(errors).toEqual([]);
});

/**
 * A link with `view=3d` (decision 0162) opens the 3D view looking at its place: for a resident, with
 * Go there. The link doesn't change the mode this device remembers. The same link for someone with
 * no character is in the 3D smoke.
 */
test("a link with view=3d opens the world in 3D looking at its place", async ({ page }) => {
  test.slow();
  const errors = watchErrors(page, { console: "all" });
  const fern = await persona(page.request, "settled", { name: "Fern3d" });
  const scene = page.locator("#world-3d");

  await test.step("a resident's link to her opens 3D with Go there, and the map stays the default", async () => {
    const moss = await persona(page.request, "visitor", { name: "Moss3d" });
    await signIn(page, moss);
    await page.goto(`/world?at=${fern.id}&view=3d`);
    await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator("#look-card-title")).toHaveText(fern.name);
    await expect(page.getByRole("button", { name: "Go there", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "3D view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    // Back on the map, and with no plot yet the toggle waits for one (decision 0234).
    const toggle = page.locator("#world-mode");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toBeHidden();
    await expect(scene.locator("canvas")).toHaveCount(0);
  });

  expect(errors).toEqual([]);
});
