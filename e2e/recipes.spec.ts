import { expect, type Page, test } from "@playwright/test";
import { act, openRecipes, persona, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Recipes you learn (RFC 0024) on a phone. Hazel lives here before recipes open and keeps her full
 * kitchen. Juniper joins after: her first kitchen asks her to pick 3 recipes, the kitchen then
 * lists what she knows with how many more there are to learn, and that link opens the shop's
 * Recipes shelf, where she takes a free pick, buys a card, and is turned down for one she can no
 * longer afford, in the server's words. Opening recipes changes the world for everyone, so this
 * spec borrows the bounties spec's server (`SWITCH_SPECS` in `ports.ts`).
 */

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

type Who = Awaited<ReturnType<typeof persona>>;
let hazel: Who | undefined;
let juniper: Who | undefined;

/** Put a kitchen up and to the right of where `who` stands (their hearth), over the API. */
async function kitchenBy(page: Page, who: Who) {
  const world = await (await page.request.get("/v1/world")).json();
  const { x, y } = world.residents.find((r: { id: string }) => r.id === who.id);
  const placed = await act(page.request, who.token, {
    type: "place",
    x: x + 1,
    y: y - 1,
    block: "kitchen",
  });
  expect(placed.ok).toBe(true);
}

test("a newcomer picks recipes at her first kitchen, and it lists what she knows", async ({
  page,
}) => {
  const errors = watchErrors(page);
  hazel = await persona(page.request, "settled", { name: "Hazel" });
  await openRecipes(page.request);
  juniper = await persona(page.request, "stocked", { name: "Juniper", coins: 100 });
  expect((await read(page.request, juniper.token, "/v1/inventory")).inventory.recipePicks).toBe(3);
  await kitchenBy(page, juniper);

  await signIn(page, juniper);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, 1, -1);
  const picks = page.locator(".picks-sheet");
  await expect(picks.getByRole("heading", { name: "Pick 3 recipes to start" })).toBeVisible();
  await expect(picks.locator(".picks-left")).toHaveText("3 free picks left");
  // The kitchen's cards come first, each with its picture and what it uses.
  await expect(picks.locator(".section-title").first()).toHaveText("At a kitchen");
  const lemonade = picks.locator('[data-recipe="recipe:lemonade"]');
  await expect(lemonade).toContainText("Uses 2 lemons");
  await expect(lemonade.locator("svg.item-art")).toBeVisible();
  await page.screenshot({ path: "test-results/recipes-picks.png" });
  await lemonade.getByRole("button", { name: "Pick lemonade" }).click();
  await expect(picks.locator(".picks-left")).toHaveText("2 free picks left");
  await expect(lemonade.getByRole("button")).toHaveText("Picked");
  // The live socket says so, privately.
  await expect(page.locator("#toast")).toContainText("You learned lemonade.");

  // Not now: the kitchen, with only what she knows.
  await picks.getByRole("button", { name: "Not now" }).click();
  const kitchen = page.locator(".workshop-sheet");
  await expect(kitchen).toBeVisible();
  await expect(kitchen.locator(".workshop-row", { hasText: "Lemonade" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-row", { hasText: "Herb tea" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-row", { hasText: "Tomato sauce" })).toHaveCount(0);
  const learn = kitchen.locator(".workshop-learn");
  await expect(learn).toHaveText("6 more recipes to learn");
  await page.screenshot({ path: "test-results/recipes-kitchen.png" });

  // The link lands on the shop's Recipes shelf, where her picks are still free.
  await learn.click();
  await expect(page).toHaveURL(/\/shop#recipes$/);
  const shelf = page.locator("#recipes");
  await expect(shelf).toBeInViewport();
  await expect(shelf.locator('[data-sku="recipe:lemonade"] .shop-buy')).toHaveText("You know this");
  const sachet = shelf.locator('[data-sku="recipe:herb_sachet"]');
  await expect(sachet).toContainText("At a workbench");
  await sachet.getByRole("button", { name: /^Free pick/ }).click();
  await expect(page.locator("#site-toast")).toContainText("You learned herb sachet.");
  await expect(sachet.locator(".shop-buy")).toHaveText("You know this");
  expect(errors).toEqual([]);
});

test("she buys a card once her picks are used, and a card she can't afford says why", async ({
  page,
}) => {
  if (!juniper) throw new Error("The first test makes Juniper");
  const errors = watchErrors(page);
  // Her last free pick, over the API.
  expect(
    (await act(page.request, juniper.token, { type: "pick_recipe", recipe: "flower_box" })).ok,
  ).toBe(true);
  await signIn(page, juniper);
  await page.goto("/shop#recipes");
  const shelf = page.locator("#recipes");
  const sauce = shelf.locator('[data-sku="recipe:tomato_sauce"] .shop-buy');
  await expect(sauce).toHaveText("Buy for 30 coins");
  await sauce.click();
  await expect(page.locator("#site-toast")).toContainText("You learned tomato sauce.");
  await expect(sauce).toHaveText("You know this");
  await page.screenshot({ path: "test-results/recipes-shelf.png" });

  // The well's Buy is on, then her coins go elsewhere before she taps it.
  const well = shelf.locator('[data-sku="recipe:well"] .shop-buy');
  await expect(well).toHaveText("Buy for 35 coins");
  let balance = (await read(page.request, juniper.token, "/v1/shop")).you.balance as number;
  const cheap = ["barrel", "bookshelf", "lamp_post", "signpost", "fried_minnows", "fish_stew"];
  while (balance >= 35) {
    const card = cheap.shift();
    if (!card) throw new Error("Ran out of cards to spend on");
    await act(page.request, juniper.token, { type: "shop_buy", sku: `recipe:${card}`, count: 1 });
    balance = (await read(page.request, juniper.token, "/v1/shop")).you.balance;
  }
  const why = await act(page.request, juniper.token, {
    type: "shop_buy",
    sku: "recipe:well",
    count: 1,
    dry: true,
  });
  expect(why.error.code).toBe("not_enough_coins");
  await well.click();
  await expect(page.locator("#site-toast")).toContainText(why.error.message);
  await expect(well).toHaveText("Buy for 35 coins");
  expect(errors).toEqual([]);
});

test("a resident from before recipes opened still sees her full kitchen", async ({ page }) => {
  if (!hazel) throw new Error("The first test makes Hazel");
  const errors = watchErrors(page);
  expect((await read(page.request, hazel.token, "/v1/inventory")).inventory.recipePicks).toBe(0);
  await kitchenBy(page, hazel);
  await signIn(page, hazel);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, 1, -1);
  const kitchen = page.locator(".workshop-sheet");
  await expect(kitchen.locator(".workshop-row", { hasText: "Tomato sauce" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-row", { hasText: "Lemonade" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-learn")).toBeHidden();
  await expect(page.locator(".picks-sheet")).toHaveCount(0);
  expect(errors).toEqual([]);
});
