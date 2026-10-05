import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * Plot photos (issue #34) at 390x844: a resident takes a photo of their home from their profile,
 * sees the picture the server drew, and posts it.
 */

async function join(request: APIRequestContext, name: string) {
  const res = await request.post("/v1/session", { data: { name, kind: "human" } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { id: body.residentId as string, token: body.token as string };
}

async function act(request: APIRequestContext, token: string, action: unknown) {
  const res = await request.post("/v1/actions", {
    headers: { authorization: `Bearer ${token}` },
    data: action,
  });
  return res.json();
}

/** An unclaimed plot, read from the shared world, skipping the Commons. */
async function freePlot(request: APIRequestContext): Promise<[number, number]> {
  const world = await (await request.get("/v1/world")).json();
  const { width, height, plotSize } = world.config;
  const taken = new Set(world.plots.map((p: { px: number; py: number }) => `${p.px},${p.py}`));
  taken.add(`${world.commons.px},${world.commons.py}`);
  for (let py = 0; py < height / plotSize; py++) {
    for (let px = width / plotSize - 1; px >= 0; px--) {
      if (!taken.has(`${px},${py}`)) return [px, py];
    }
  }
  throw new Error("No free plots left in the test world");
}

async function signIn(page: Page, who: { id: string; token: string }) {
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [who.token, who.id] as const,
  );
}

test("a resident takes a photo of their home and posts it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  const rue = await join(page.request, "Rue");
  const [px, py] = await freePlot(page.request);
  expect((await act(page.request, rue.token, { type: "settle", px, py })).ok).toBe(true);
  expect((await act(page.request, rue.token, { type: "build_starter_home" })).ok).toBe(true);

  await signIn(page, rue);
  await page.goto(`/r/${rue.id}`);
  // It lives in the profile's "…" menu.
  await page.getByRole("button", { name: "More for this profile" }).click();
  const take = page.locator(".plot-photo-open");
  await expect(take).toBeVisible();
  await take.click();

  const sheet = page.locator(".plot-photo-sheet");
  await expect(sheet).toBeVisible();
  const img = sheet.locator(".plot-photo-img");
  await expect(img).toHaveAttribute("src", /^\/media\/m_[0-9a-f]{16}$/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1200);
  await page.screenshot({ path: "test-results/plot-photo-sheet.png" });

  await sheet.locator("#plot-photo-text").fill("Our little hut");
  await sheet.locator(".plot-photo-post").click();
  await expect(page.locator("#site-toast")).toContainText("Posted");
  await expect(sheet).toBeHidden();

  const posts = await (await page.request.get(`/v1/residents/${rue.id}/posts`)).json();
  expect(posts.posts[0]).toMatchObject({ text: "Our little hut" });
  expect(posts.posts[0].media[0]).toMatchObject({ kind: "image", type: "image/png" });
  expect(errors).toEqual([]);
});
