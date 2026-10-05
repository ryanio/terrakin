import { expect, test } from "@playwright/test";
import { act, countFrames, framesWhileIdle, join, read, signIn, watchErrors } from "./support";

/**
 * The world in 3D at phone size (decision 0060): the toggle, a neighbor drawn nearby, walking by
 * tapping the 3D ground, the choice remembered, back to the map, and nothing left drawing after
 * leaving. WebGL runs on Chromium's SwiftShader here.
 */
test("the world switches to 3D, walks by tapping, and stops drawing when you leave", async ({
  page,
}) => {
  await countFrames(page);
  const errors = watchErrors(page, { console: "all" });

  // We stand a few steps east of the busy spawn, and a neighbor arrives over the API beside us.
  const ada = await join(page.request, "Ada3d");
  const juniper = await join(page.request, "Juniper", { kind: "agent", color: "plum" });
  for (const [who, steps] of [
    [ada, ["e", "e", "e"]],
    [juniper, ["e", "e", "e", "n"]],
  ] as const) {
    for (const dir of steps)
      expect((await act(page.request, who.token, { type: "move", dir })).ok).toBe(true);
  }
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
  await expect(scene).toHaveAttribute("aria-label", /Juniper/);
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

  // The choice is remembered on this device.
  await page.reload();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });

  // Off: back to the map, and the scene is gone.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(scene.locator("canvas")).toHaveCount(0);
  await expect(page.locator("canvas#world")).toBeVisible();

  // On again, then leave for the feed: nothing keeps drawing.
  await toggle.click();
  await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
  await page.locator("#hud-feed").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("canvas.stage-canvas")).toHaveCount(0);
  expect(await framesWhileIdle(page)).toBe(0);

  expect(errors).toEqual([]);
});
