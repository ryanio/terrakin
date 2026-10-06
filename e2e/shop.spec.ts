import { expect, type Page, test } from "@playwright/test";
import {
  act,
  advanceDay,
  overflowsSideways,
  type Resident,
  read,
  settler,
  signIn,
  watchErrors,
} from "./support";

/**
 * The town shop (RFC 0008) on a phone: a resident grows herbs, waits for a day the town buys
 * them, sells them from /shop, and buys a lantern with what they have. A visitor sees the same
 * shop with a way to join. Then autumn's stock (RFC 0017): tagged and bought in autumn. Then
 * Halloween (RFC 0022): a newcomer buys a costume from the Halloween shelf on October 31, knocks
 * at the first resident's door from the card on her plot, and she hears about it. Last, autumn's
 * stock is gone from the shelves once autumn ends. Moves its server's clock on, by months if it has
 * to, so the tests run in order.
 */

const DAY_MS = 86_400_000;

/** Days from world day `day` to the next day in autumn (September to November, UTC): 0 in it. */
function daysToAutumn(day: number): number {
  const date = new Date(day * DAY_MS);
  const month = date.getUTCMonth();
  if (month >= 8 && month <= 10) return 0;
  const year = date.getUTCFullYear() + (month === 11 ? 1 : 0);
  return Date.UTC(year, 8, 1) / DAY_MS - day;
}

/** Days from an autumn world day to December 1, when winter starts. */
const daysToWinter = (day: number) =>
  Date.UTC(new Date(day * DAY_MS).getUTCFullYear(), 11, 1) / DAY_MS - day;

/** Days from world day `day` to the next October 31 (UTC), trick-or-treat night: 0 on it. */
function daysToHalloweenNight(day: number): number {
  const year = new Date(day * DAY_MS).getUTCFullYear();
  const night = Date.UTC(year, 9, 31) / DAY_MS;
  return night >= day ? night - day : Date.UTC(year + 1, 9, 31) / DAY_MS - day;
}

// The clock only moves forward, so the season steps run in order, each a test of its own with its
// own 30 seconds, all on Hazel, whom the first one settles.
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

let settledHazel: Resident | undefined;

/** Hazel, settled by the first test. */
function settled(): Resident {
  if (!settledHazel) throw new Error("The first test settles Hazel");
  return settledHazel;
}

const shopDay = async (page: Page) =>
  (await read(page.request, settled().token, "/v1/shop")).shop.day;

test("a visitor sees the shop; a resident sells herbs to the town and buys a lantern", async ({
  page,
}) => {
  const errors = watchErrors(page);
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
    const buying = (await read(page.request, hazel.token, "/v1/shop")).shop.buying;
    await page.goto("/shop");
    await expect(page.locator(".shop-orders li")).toHaveCount(buying.length);
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
  settledHazel = hazel;
});

test("autumn's stock is tagged and sold in autumn", async ({ page }) => {
  const errors = watchErrors(page);
  const hazel = settled();
  await signIn(page, hazel);
  // One jump each way, so the test takes as long in December as it does in October.
  const toAutumn = daysToAutumn(await shopDay(page));
  if (toAutumn > 0) await advanceDay(page.request, toAutumn);
  await page.goto("/shop");
  const seeds = page.locator('.shop-item[data-sku="pumpkin_seed"]');
  await expect(seeds.locator(".shop-season")).toHaveText("This autumn");
  await expect(page.locator('.shop-order[data-kind="pumpkin"]')).toContainText("This autumn");
  await seeds.getByRole("button", { name: /Buy for 4 coins/ }).click();
  await expect(page.locator("#site-toast")).toContainText("You bought pumpkin seed");
  await expect(seeds).toContainText("You have 1");
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/shop-autumn.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("Halloween: a costume from its shelf, and a knock at a neighbor's door on October 31", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const hazel = settled();
  const toNight = daysToHalloweenNight(await shopDay(page));
  if (toNight > 0) await advanceDay(page.request, toNight);
  // A newcomer's welcome gift and first allowance buy cat ears from the Halloween shelf.
  const rowan = await settler(page.request, "Rowan");
  await signIn(page, rowan);
  await page.goto("/shop");
  await expect(page.locator("#shop-holiday-title")).toHaveText("For Halloween");
  const ears = page.locator('.shop-item[data-sku="cat_ears"]');
  await expect(ears.locator(".shop-holiday")).toHaveText("Halloween");
  await ears.getByRole("button", { name: /Buy for 40 coins/ }).click();
  await expect(page.locator("#site-toast")).toContainText("You bought cat ears");
  await expect(ears.getByRole("button")).toHaveText("Yours");
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/shop-halloween.png", fullPage: true });
  expect((await act(page.request, rowan.token, { type: "profile", wear: ["cat_ears"] })).ok).toBe(
    true,
  );

  // To Hazel's door, then Trick or treat from the card on her plot.
  const world = await (await page.request.get("/v1/world")).json();
  const door = world.plots.find((p: { ownerId: string }) => p.ownerId === hazel.id);
  expect(
    (await act(page.request, rowan.token, { type: "visit", px: door.px, py: door.py })).ok,
  ).toBe(true);
  await page.goto("/world");
  const knock = page.locator("#visit-knock");
  await expect(knock).toBeVisible();
  await expect(knock).toHaveText("Trick or treat");
  const box = await knock.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(36);
  await knock.click();
  await expect(page.locator("#toast")).toContainText("Trick or treat!");
  await expect(knock).toHaveText("Knocked");
  await expect(knock).toBeDisabled();
  const things = (await read(page.request, rowan.token, "/v1/inventory")).inventory;
  expect(things.stacks).toContainEqual({ kind: "candy", count: 1 });
  await page.screenshot({ path: "test-results/trick-or-treat.png" });

  // Hazel hears a trick-or-treater came by.
  await signIn(page, hazel);
  await page.goto("/notifications");
  await expect(page.locator('.notif[data-type="trick_or_treat"]')).toContainText(
    "Rowan came trick-or-treating at your door",
  );
  await page.screenshot({ path: "test-results/trick-or-treat-notice.png" });
  expect(errors).toEqual([]);
});

test("autumn's stock is gone once autumn ends", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, settled());
  await advanceDay(page.request, daysToWinter(await shopDay(page)));
  await page.goto("/shop");
  await expect(page.locator('.shop-item[data-sku="lantern"]')).toBeVisible();
  await expect(page.locator('.shop-item[data-sku="pumpkin_seed"]')).toHaveCount(0);
  await expect(page.locator(".shop-season")).toHaveCount(0);
  expect(errors).toEqual([]);
});
