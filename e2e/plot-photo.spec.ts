import { expect, test } from "@playwright/test";
import { act, freePlots, join, signIn, watchErrors } from "./support";

/**
 * Plot photos (issue #34) at 390x844: a resident takes a photo of their home from their profile,
 * sees the picture the server drew, and posts it.
 */

test("a resident takes a photo of their home and posts it", async ({ page }) => {
  const errors = watchErrors(page);
  const rue = await join(page.request, "Roux");
  const [plot] = await freePlots(page.request, 1, "top-right");
  if (!plot) throw new Error("No free plots left in the test world");
  const [px, py] = plot;
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
