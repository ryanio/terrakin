import { expect, test } from "@playwright/test";
import { act, join, persona, read, signIn, watchErrors } from "./support";

/**
 * The 3D smoke every push runs (decision 0200): a `view=3d` link opens the world in 3D and the
 * scene draws, a tap on the 3D ground walks, and when WebGL won't start the toggle puts you back
 * on the map. Software WebGL runs on Chromium's SwiftShader here, so this file stays small; the
 * deeper 3D checks (the plot view and its photo, night light, the camera and the d-pad, the
 * remembered mode, nothing left drawing) run nightly in `three-d.spec.ts` and `world-3d.spec.ts`.
 */

test("a view=3d link opens the world in 3D, and a tap on the ground walks", async ({ page }) => {
  test.slow();
  const errors = watchErrors(page, { console: "all" });
  const scene = page.locator("#world-3d");

  await test.step("someone with no character opens a plot's link in 3D", async () => {
    const fennel = await persona(page.request, "settled", { name: "Fennel3s" });
    const [px, py] = fennel.plot ?? [0, 0];
    await page.goto(`/world?at=${px},${py}&view=3d`);
    await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator("canvas#world")).toBeHidden();
    await expect(page.locator("#look-card-title")).toHaveText(`${fennel.name}'s plot`);
    await expect(page.getByRole("button", { name: "Step inside to go there" })).toBeVisible();
    await expect(scene).toHaveAttribute("aria-label", new RegExp(fennel.name));
  });

  await test.step("a resident turns 3D on and walks by tapping the ground", async () => {
    // A few steps east of the busy spawn, so the ground to the west is open.
    const sage = await join(page.request, "Sage3s");
    for (const dir of ["e", "e", "e"])
      expect((await act(page.request, sage.token, { type: "move", dir })).ok).toBe(true);
    const me = async () =>
      (await read(page.request, sage.token, "/v1/world")).residents.find(
        (r: { id: string }) => r.id === sage.id,
      );
    await signIn(page, sage, { now: true });
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    const toggle = page.getByRole("button", { name: "3D view" });
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(scene.locator("canvas")).toHaveCount(1, { timeout: 20_000 });

    const start = await me();
    const vp = page.viewportSize();
    if (!vp) throw new Error("no viewport");
    // Someone may stand where we tap (a tap on a resident names them), so try a few spots.
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
  });

  expect(errors).toEqual([]);
});

test("when WebGL won't start, the 3D toggle puts you back on the map", async ({ page }) => {
  // The browser has WebGL 2, so the toggle is offered, but no canvas will give a context.
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind, ...rest) {
      if (kind === "webgl2" || kind === "webgl") return null;
      return get.call(this, kind, ...rest);
    } as typeof get;
  });
  // three.js logs the failed context before the world catches it, so only page errors count.
  const errors = watchErrors(page, { console: "none" });
  const reed = await join(page.request, "Reed3s");
  await signIn(page, reed);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  const toggle = page.getByRole("button", { name: "3D view" });
  await toggle.click();
  await expect(page.locator("#toast")).toContainText(
    "The 3D view stopped working here, so you're back on the map.",
  );
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("canvas#world")).toBeVisible();
  await expect(page.locator("#world-3d canvas")).toHaveCount(0);
  // The map is remembered for this device, so a reload stays on it.
  await page.reload();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});
