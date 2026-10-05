import { expect, test } from "@playwright/test";
import { act, join, settler, signIn, tinyPng, watchErrors } from "./support";

/**
 * Galleries (RFC 0005 step 3) at 390x844: a resident's piece of art on a pedestal in a plot opened
 * as a gallery, listed on /galleries and their profile, and a neighbor admiring it from the list.
 */
test("a gallery is listed, shows on its profile, and can be admired", async ({ page }) => {
  const errors = watchErrors(page);
  const rowan = await settler(page.request, "Rowan");
  const auth = { authorization: `Bearer ${rowan.token}` };
  const upload = await page.request.post("/v1/media", {
    headers: { ...auth, "content-type": "image/png" },
    data: tinyPng(),
  });
  const media = (await upload.json()).media.id as string;
  expect(
    (await act(page.request, rowan.token, { type: "make_piece", media, title: "Dusk" })).ok,
  ).toBe(true);
  const piece = (await (await page.request.get("/v1/inventory", { headers: auth })).json())
    .inventory.goods[0];
  const world = await (await page.request.get("/v1/world")).json();
  const me = world.residents.find((r: { id: string }) => r.id === rowan.id);
  const at = { x: me.x - 1, y: me.y - 1 };
  const { plotSize } = world.config;
  expect(
    (await act(page.request, rowan.token, { type: "place", ...at, block: "pedestal" })).ok,
  ).toBe(true);
  expect(
    (await act(page.request, rowan.token, { type: "display", item: piece.id, ...at })).ok,
  ).toBe(true);
  const plot = { px: Math.floor(at.x / plotSize), py: Math.floor(at.y / plotSize) };
  expect(
    (await act(page.request, rowan.token, { type: "set_gallery", ...plot, open: true })).ok,
  ).toBe(true);

  // A neighbor finds it on /galleries and admires it.
  const sage = await join(page.request, "Sage");
  await signIn(page, sage);
  await page.goto("/galleries");
  const card = page.locator(".gallery-card", { hasText: "Rowan" });
  const row = card.locator(".gallery-piece", { hasText: "Dusk" });
  await expect(row).toContainText("Piece of art “Dusk”");
  await expect(row).toContainText("Not admired yet");
  await expect(row.locator("img.thing-picture")).toBeVisible();
  await page.screenshot({ path: "test-results/galleries.png" });
  await row.getByRole("button", { name: "Admire" }).click();
  await expect(row).toContainText("Admired once");
  await expect(page.locator("#site-toast")).toContainText("You admired it");

  // Rowan's profile shows the gallery under "On display", without an Admire button for Rowan.
  await signIn(page, rowan);
  await page.goto(`/r/${rowan.id}`);
  const shown = page.locator(".profile-galleries");
  await expect(shown.locator(".gallery-piece", { hasText: "Dusk" })).toContainText("Admired once");
  await expect(shown.getByRole("button", { name: "Admire" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/galleries-profile.png" });

  expect(errors).toEqual([]);
});
