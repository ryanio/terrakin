import { expect, type Page, test } from "@playwright/test";
import {
  countFrames,
  framesWhileIdle,
  freePlots,
  join,
  settleFree,
  signIn,
  watchErrors,
} from "./support";

/**
 * The 3D views at phone size: a plot seeded over REST opens in 3D, draws real pixels through
 * WebGL (Chromium's SwiftShader in CI), takes a photo, gets dark at night, and leaves nothing
 * running behind it.
 */

/**
 * A sample of the photo: how many distinct colors it has (a blank or failed render has one or two)
 * and how light it is on average, from 0 to 1.
 */
async function photoSample(page: Page): Promise<{ colors: number; light: number }> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>(".view3d-shot");
    if (!img) return { colors: 0, light: 0 };
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (!g) return { colors: 0, light: 0 };
    g.drawImage(img, 0, 0, 64, 64);
    const data = g.getImageData(0, 0, 64, 64).data;
    const seen = new Set<string>();
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r = 0, gr = 0, b = 0] = [data[i], data[i + 1], data[i + 2]];
      seen.add(`${r >> 4},${gr >> 4},${b >> 4}`);
      light += (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
    }
    return { colors: seen.size, light: light / (data.length / 4) };
  });
}

// Each 3D load is seconds of software WebGL on a CI runner, so the night check is a test of its
// own, run after the day one on the same plot and compared with its photo.
test.describe("a plot in 3D", () => {
  test.describe.configure({ mode: "serial" });

  /** The plot the day test settled, and how light its photo was. */
  let day: { residentId: string; light: number } | undefined;

  test("a plot opens in 3D, takes a photo, and stops drawing when you leave", async ({ page }) => {
    await countFrames(page);
    const errors = watchErrors(page, { console: "all" });

    // An agent settles a plot and builds the starter home, all over REST.
    const session = await (
      await page.request.post("/v1/session", {
        data: { name: "Larch", kind: "agent", color: "rose", shape: "square" },
      })
    ).json();
    const auth = { authorization: `Bearer ${session.token}` };
    const act = async (data: object) => {
      const res = await page.request.post("/v1/actions", { headers: auth, data });
      expect(res.ok(), JSON.stringify(await res.json())).toBe(true);
    };
    await settleFree(page.request, session.token, await freePlots(page.request, 5, "top-right"));
    await act({ type: "build_starter_home", walls: "stone", windows: "glass" });

    await page.goto(`/r/${session.residentId}/3d`);
    await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".view3d-title")).toHaveText("Larch's home");
    const canvas = page.locator(".view3d canvas");
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate((c: HTMLCanvasElement) => c.getContext("webgl2") !== null)).toBe(
      true,
    );
    await page.screenshot({ path: "test-results/three-d-plot.png" });

    // A photo of the scene has real pixels in it.
    await page.getByRole("button", { name: "Take a photo" }).click();
    await expect(page.locator(".view3d-shot")).toBeVisible();
    const photo = await photoSample(page);
    expect(photo.colors).toBeGreaterThan(12);
    day = { residentId: session.residentId, light: photo.light };
    const sheet = page.getByRole("dialog", { name: "Your photo" });
    // It opens with focus on the sheet, so Save doesn't open looking picked.
    await expect(sheet.locator(".sheet-card")).toBeFocused();
    await expect(sheet.getByRole("link", { name: "Save" })).toHaveAttribute("download", /\.png$/);
    const intent = new URL(
      (await sheet.getByRole("link", { name: "Share on X" }).getAttribute("href")) ?? "",
    );
    expect(intent.origin + intent.pathname).toBe("https://x.com/intent/post");
    expect(intent.searchParams.get("text")).toBe(
      `Larch's home on Terrakin ${new URL(`/r/${session.residentId}/3d`, page.url()).href}`,
    );
    // On a phone it is a bottom sheet: the full width, flush with the bottom edge.
    const screen = page.viewportSize();
    await expect
      .poll(async () => {
        const b = await sheet.locator(".sheet-card").boundingBox();
        return b && [Math.round(b.x), Math.round(b.width), Math.round(b.y + b.height)];
      })
      .toEqual([0, screen?.width, screen?.height]);

    // Closing the photo puts focus back on the button that took it.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Take a photo" })).toBeFocused();

    // Back goes to the profile, and nothing keeps drawing.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${session.residentId}$`));
    await expect(page.locator("canvas.stage-canvas")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/view3d-open/);
    expect(await framesWhileIdle(page)).toBe(0);

    // The profile links back into 3D, with Jump in on its action row.
    await expect(page.getByRole("link", { name: "Jump into their plot in 3D" })).toHaveAttribute(
      "href",
      `/r/${session.residentId}/3d`,
    );

    expect(errors).toEqual([]);
  });

  test("at midnight the same plot is drawn, and darker", async ({ page }) => {
    if (!day) throw new Error("The day test settles the plot this one draws at night");
    const { residentId } = day;
    const errors = watchErrors(page, { console: "all" });
    // Clients read the time of day off the snapshot's clock (decision 0011), so move it to this
    // day's midnight: phase 0.75, where 0 is dawn and 0.25 noon.
    await page.route(/\/v1\/world$/, async (route) => {
      const res = await route.fetch();
      const world = await res.json();
      const { nowMs, dayLengthMs } = world.time;
      world.time.nowMs = nowMs - (nowMs % dayLengthMs) + 0.75 * dayLengthMs;
      await route.fulfill({ response: res, body: JSON.stringify(world) });
    });
    await page.goto(`/r/${residentId}/3d`);
    await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "test-results/three-d-plot-night.png" });
    await page.getByRole("button", { name: "Take a photo" }).click();
    await expect(page.locator(".view3d-shot")).toBeVisible();
    const night = await photoSample(page);
    expect(night.colors).toBeGreaterThan(12);
    expect(night.light).toBeLessThan(day.light * 0.8);
    expect(errors).toEqual([]);
  });
});

test("the 3D gallery and one item up close render, and your own plot before you have one points to the world", async ({
  page,
}) => {
  const errors = watchErrors(page, { console: "all" });
  await page.goto("/gallery/3d");
  await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
  await page.goto("/gallery/3d?item=jam-lemon");
  await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".view3d canvas")).toHaveCount(1);
  expect(errors).toEqual([]);

  // Past the error watch: this step checks only what the page says.
  await test.step("your own plot in 3D, before you have one, points you to the world", async () => {
    const sorrel = await join(page.request, "Sorrel");
    await signIn(page, sorrel);
    await page.goto(`/r/${sorrel.id}/3d`);
    await expect(
      page.getByRole("heading", { name: "You haven't claimed a plot yet" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the world" })).toHaveAttribute(
      "href",
      "/world",
    );
  });
});
