import { expect, test } from "@playwright/test";
import { act, advanceDay, overflowsSideways, read, settler, signIn, watchErrors } from "./support";

/**
 * The town shop (RFC 0008) on a phone: a resident grows herbs, waits for a day the town buys
 * them, sells them from /shop, and buys a lantern with what they have. A visitor sees the same
 * shop with a way to join. Moves its server's clock on.
 */

test("a visitor sees the shop; a resident sells herbs to the town and buys a lantern", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const hazel = await settler(page.request, "Hazel");
  const me = async () => {
    const world = await (await page.request.get("/v1/world")).json();
    return world.residents.find((r: { id: string }) => r.id === hazel.id);
  };
  const { x, y } = await me();
  // A planter up and to the left of the hearth, with herbs in it.
  expect(
    (await act(page.request, hazel.token, { type: "place", x: x - 1, y: y - 1, block: "planter" }))
      .ok,
  ).toBe(true);
  expect(
    (await act(page.request, hazel.token, { type: "plant", x: x - 1, y: y - 1, seed: "herb" })).ok,
  ).toBe(true);

  // Herbs take two days. Then wait for a day the town buys them (it rotates every few days).
  await advanceDay(page.request);
  await advanceDay(page.request);
  const buysHerbs = async () =>
    (await read(page.request, hazel.token, "/v1/shop")).shop.buying.some(
      (b: { kind: string }) => b.kind === "herb",
    );
  for (let i = 0; i < 6 && !(await buysHerbs()); i++) await advanceDay(page.request);
  expect(await buysHerbs()).toBe(true);
  expect((await act(page.request, hazel.token, { type: "harvest", x: x - 1, y: y - 1 })).ok).toBe(
    true,
  );
  const before = (await read(page.request, hazel.token, "/v1/shop")).you.balance as number;

  await test.step("visitors see the catalog and today's buying, with a way to join", async () => {
    await page.goto("/shop");
    await expect(page.locator(".shop-orders li")).toHaveCount(4);
    await expect(page.locator('.shop-item[data-sku="top_hat"]')).toContainText("80 coins");
    await expect(page.getByRole("link", { name: "Join to shop" })).toBeVisible();
    await expect(page.locator(".shop-buy")).toHaveCount(0);
    expect(await overflowsSideways(page)).toBe(false);
  });

  await signIn(page, hazel);
  await page.goto("/shop");
  await expect(page.getByRole("heading", { level: 1, name: "The town shop" })).toBeVisible();
  await expect(page.locator("#shop-balance")).toContainText(String(before));

  // Today's buying: herbs, with a button to sell all three.
  const herbs = page.locator('.shop-order[data-kind="herb"]');
  await expect(herbs).toContainText("Bunches of herbs");
  await expect(herbs).toContainText("3 more today, you have 3");
  const sell = herbs.getByRole("button", { name: "Sell 3" });
  const box = await sell.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: "test-results/shop-buying.png", fullPage: true });
  await sell.click();
  await expect(page.locator("#site-toast")).toContainText("Sold to the town for 3 coins");
  await expect(herbs).toContainText("sold out for you today");
  await expect(herbs.getByRole("button", { name: "Sell" })).toBeDisabled();
  await expect(page.locator("#shop-balance")).toContainText(String(before + 3));

  // A lantern from the decor shelf, and the shelf says Hazel has one.
  const lantern = page.locator('.shop-item[data-sku="lantern"]');
  await expect(lantern.getByRole("link", { name: "See it in 3D" })).toHaveAttribute(
    "href",
    "/gallery/3d?item=lantern",
  );
  await lantern.getByRole("button", { name: /Buy for 40 coins/ }).click();
  await expect(page.locator("#site-toast")).toContainText("You bought paper lantern");
  await expect(lantern).toContainText("You have 1");
  await expect(page.locator("#shop-balance")).toContainText(String(before + 3 - 40));
  // The purse in the top bar follows at once.
  await expect(
    page.getByRole("link", { name: `Your purse: ${before + 3 - 40} coins` }),
  ).toBeVisible();
  // What Hazel can't afford says how short she is, and can't be pressed.
  const raincoat = page.locator('.shop-item[data-sku="raincoat"]');
  await expect(raincoat.getByRole("button")).toBeDisabled();
  await expect(raincoat.getByRole("button")).toContainText("short");

  const things = (await read(page.request, hazel.token, "/v1/inventory")).inventory;
  expect(things.stacks).toContainEqual({ kind: "lantern", count: 1 });
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/shop-bought.png", fullPage: true });
  expect(errors).toEqual([]);
});
