import { expect, type Page, test } from "@playwright/test";

/**
 * The 3D views at phone size: a plot seeded over REST opens in 3D, draws real pixels through
 * WebGL (Chromium's SwiftShader in CI), takes a photo, and leaves nothing running behind it.
 */

/** Count animation frames the page asks for, so we can tell when nothing is drawing anymore. */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__frames++;
        cb(t);
      });
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** How many distinct colors a sample of the photo has. A blank or failed render has one or two. */
async function photoColors(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>(".view3d-shot");
    if (!img) return 0;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (!g) return 0;
    g.drawImage(img, 0, 0, 64, 64);
    const data = g.getImageData(0, 0, 64, 64).data;
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4)
      seen.add(`${(data[i] ?? 0) >> 4},${(data[i + 1] ?? 0) >> 4},${(data[i + 2] ?? 0) >> 4}`);
    return seen.size;
  });
}

test("a plot opens in 3D, takes a photo, and stops drawing when you leave", async ({ page }) => {
  await countFrames(page);
  const errors = watchErrors(page);

  // An agent settles a plot and builds the starter home, all over REST.
  const session = await (
    await page.request.post("/v1/session", {
      data: { name: "Rowan", kind: "agent", color: "rose", shape: "square" },
    })
  ).json();
  const auth = { authorization: `Bearer ${session.token}` };
  const act = async (data: object) => {
    const res = await page.request.post("/v1/actions", { headers: auth, data });
    expect(res.ok(), JSON.stringify(await res.json())).toBe(true);
  };
  // Far from the other specs' plots (duo settles at 7,1 and its neighbors).
  await act({ type: "settle", px: 1, py: 7 });
  await act({ type: "build_starter_home", walls: "stone", windows: "glass" });

  await page.goto(`/r/${session.residentId}/3d`);
  await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".view3d-title")).toHaveText("Rowan's home");
  const canvas = page.locator(".view3d canvas");
  await expect(canvas).toHaveCount(1);
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.getContext("webgl2") !== null)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/three-d-plot.png" });

  // A photo of the scene has real pixels in it.
  await page.getByRole("button", { name: "Take a photo" }).click();
  await expect(page.locator(".view3d-shot")).toBeVisible();
  expect(await photoColors(page)).toBeGreaterThan(12);
  await expect(page.getByRole("link", { name: "Save" })).toHaveAttribute("download", /\.png$/);

  // Closing the photo puts focus back on the button that took it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".view3d-shot")).toBeHidden();
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeFocused();

  // Back goes to the profile, and nothing keeps drawing.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${session.residentId}$`));
  await expect(page.locator("canvas.stage-canvas")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/view3d-open/);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  expect(after - before).toBe(0);

  // The profile links back into 3D.
  await expect(page.getByRole("link", { name: "Visit in 3D" })).toHaveAttribute(
    "href",
    `/r/${session.residentId}/3d`,
  );

  expect(errors).toEqual([]);
});

test("your own plot in 3D, before you have one, points you to the world", async ({ page }) => {
  const session = await (
    await page.request.post("/v1/session", { data: { name: "Sorrel", kind: "human" } })
  ).json();
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [session.token, session.residentId] as const,
  );
  await page.goto(`/r/${session.residentId}/3d`);
  await expect(page.getByRole("heading", { name: "You haven't claimed a plot yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the world" })).toHaveAttribute(
    "href",
    "/world",
  );
});

test("the 3D gallery and one item up close render without errors", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/gallery/3d");
  await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
  await page.goto("/gallery/3d?item=jam-lemon");
  await expect(page.locator(".view3d[data-ready]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".view3d canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});
