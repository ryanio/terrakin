import { expect, type Page, test } from "@playwright/test";
import {
  act,
  freePlots,
  openLevels,
  openRecipes,
  overflowsSideways,
  persona,
  read,
  settleFree,
  signIn,
  tapTile,
  watchErrors,
} from "./support";

/**
 * Recipes you learn (RFC 0024) on a phone. Hazel lives here before recipes open and keeps her full
 * kitchen. Juniper joins after: her first kitchen asks her to pick 3 recipes, the kitchen then
 * lists what she knows with how many more there are to learn, and that link opens the shop's
 * Recipes shelf, where she takes a free pick, buys a card, and is turned down for one she can no
 * longer afford, in the server's words. Then Ivy, standing by Wren on the Commons, taps her and
 * teaches her lemonade: both hear it, and Wren finds it at her own kitchen and sees on Ivy's
 * profile what else Ivy can teach her. Last, levels open (RFC 0029) and Linden joins: her first chair
 * shows its points over her figure, her first fishing rod takes her to Making 2 and level 2 with a
 * toast, and the chip on her profile opens her skills. Opening recipes and levels changes the world
 * for everyone, so this spec borrows the bounties spec's server (`SWITCH_SPECS` in `ports.ts`).
 */

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

type Who = Awaited<ReturnType<typeof persona>>;
let hazel: Who | undefined;
let juniper: Who | undefined;

/** Put a kitchen (or a workbench) up and to the right of where `who` stands, over the API. */
async function kitchenBy(page: Page, who: Who, block: "kitchen" | "workbench" = "kitchen") {
  const world = await (await page.request.get("/v1/world")).json();
  const { x, y } = world.residents.find((r: { id: string }) => r.id === who.id);
  const placed = await act(page.request, who.token, {
    type: "place",
    x: x + 1,
    y: y - 1,
    block,
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

test("a neighbor standing by teaches a newcomer, who hears it and finds it at her kitchen", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page);
  // Two newcomers on the Commons. Wren steps off the spawn tile, so a tap on her is a tap on her.
  const ivy = await persona(page.request, "visitor", { name: "Ivy" });
  const wren = await persona(page.request, "visitor", { name: "Wren" });
  expect((await act(page.request, ivy.token, { type: "pick_recipe", recipe: "lemonade" })).ok).toBe(
    true,
  );
  let step: { dx: number; dy: number } | undefined;
  for (const [dir, dx, dy] of [
    ["e", 1, 0],
    ["w", -1, 0],
    ["s", 0, 1],
    ["n", 0, -1],
  ] as const) {
    if ((await act(page.request, wren.token, { type: "move", dir })).ok) {
      step = { dx, dy };
      break;
    }
  }
  if (!step) throw new Error("Wren couldn't step off the spawn tile");
  // Ivy's own profile of Wren says what she could teach her.
  const seen = (await read(page.request, ivy.token, `/v1/residents/${wren.id}`)).resident;
  expect(seen.canLearn).toEqual(["lemonade"]);

  // Wren watches the world on her own phone.
  const wrenSide = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const wrenPage = await wrenSide.newPage();
  const wrenErrors = watchErrors(wrenPage);
  await signIn(wrenPage, wren);
  await wrenPage.goto("/world");
  await expect(wrenPage.locator("#hud")).toBeVisible();

  // Ivy taps Wren: her sheet lists what Ivy could teach her, with Teach.
  await signIn(page, ivy);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, step.dx, step.dy);
  const sheet = page.locator(".teach-sheet");
  await expect(sheet.getByRole("heading", { name: "Wren", exact: true })).toBeVisible();
  const lemonade = sheet.locator('[data-recipe="lemonade"]');
  await expect(lemonade.locator("svg.item-art")).toBeVisible();
  await page.screenshot({ path: "test-results/recipes-teach.png" });
  await lemonade.getByRole("button", { name: "Teach Wren lemonade" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#toast")).toContainText("You taught Wren lemonade.");
  // Wren hears it with Ivy's name, and the notification says so too.
  await expect(wrenPage.locator("#toast")).toContainText("Ivy taught you lemonade.");
  const notes = (await read(page.request, wren.token, "/v1/notifications")).notifications;
  expect(notes[0]).toMatchObject({ type: "recipe_taught", recipe: "lemonade" });

  // Wren settles a plot of her own, uses her picks, and puts a kitchen up: lemonade is there.
  await settleFree(page.request, wren.token, await freePlots(page.request, 5, "top-right"));
  for (const recipe of ["well", "barrel", "signpost"]) {
    expect((await act(page.request, wren.token, { type: "pick_recipe", recipe })).ok).toBe(true);
  }
  await kitchenBy(wrenPage, wren);
  await wrenPage.reload();
  await expect(wrenPage.locator("#hud")).toBeVisible();
  await tapTile(wrenPage, 1, -1);
  const kitchen = wrenPage.locator(".workshop-sheet");
  await expect(kitchen.locator(".workshop-row", { hasText: "Lemonade" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-row", { hasText: "Tomato sauce" })).toHaveCount(0);

  // Ivy picks the bookshelf, and her profile tells Wren she can teach it.
  expect(
    (await act(page.request, ivy.token, { type: "pick_recipe", recipe: "bookshelf" })).ok,
  ).toBe(true);
  await wrenPage.goto(`/r/${ivy.id}`);
  await expect(wrenPage.locator(".profile-teach")).toHaveText("Ivy can teach you bookshelf.");
  await wrenPage.screenshot({ path: "test-results/recipes-can-teach.png" });
  expect(errors).toEqual([]);
  expect(wrenErrors).toEqual([]);
  await wrenSide.close();
});

test("a resident from before recipes opened keeps her full kitchen, and levels open for a newcomer", async ({
  page,
}) => {
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

  const neighbor = hazel;
  await test.step("levels open: a newcomer's first two makes reach level 2, and her profile shows it", async () => {
    await openLevels(page.request);
    const linden = await persona(page.request, "stocked", { name: "Linden" });
    // Her free picks, over the API, so the workbench opens on its own sheet.
    for (const recipe of ["well", "barrel", "signpost"]) {
      expect((await act(page.request, linden.token, { type: "pick_recipe", recipe })).ok).toBe(
        true,
      );
    }
    await kitchenBy(page, linden, "workbench");
    await signIn(page, linden);
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await tapTile(page, 1, -1);
    const bench = page.locator(".workshop-sheet");
    // A first chair: 2 points for making it and 10 for a first, over her figure for a moment.
    await bench.locator(".workshop-row", { hasText: "Chair" }).getByRole("button").click();
    await expect(page.locator("#world-gain")).toHaveText("+12 Making");
    // A first fishing rod makes 24 points: Making 2, and level 2. Her figure sparkles.
    await expect(bench).toBeHidden();
    await tapTile(page, 1, -1);
    await bench.locator(".workshop-row", { hasText: "Fishing rod" }).getByRole("button").click();
    await expect(page.locator("#toast")).toContainText("You reached Making 2 and level 2.");
    await expect(page.locator("#world")).toHaveAttribute("data-feeling", "laugh");
    await page.screenshot({ path: "test-results/levels-toast.png" });

    // The chip on her profile opens her skills, with what only she sees.
    await page.goto(`/r/${linden.id}`);
    const chip = page.locator(".profile-level");
    await expect(chip).toHaveText("Level 2");
    await chip.click();
    const skills = page.locator(".level-sheet");
    await expect(skills.getByRole("heading", { name: "Your skills" })).toBeVisible();
    await expect(skills.locator(".level-total")).toHaveText("Level 2. 36 points to level 3.");
    const making = skills.locator('[data-skill="making"]');
    await expect(making).toContainText("Making 2");
    await expect(making).toContainText("36 points to Making 3");
    await expect(making).toContainText("4 of 20 today");
    await expect(making.getByRole("progressbar")).toBeVisible();
    await expect(skills.locator('[data-skill="growing"]')).toContainText("Growing 1");
    expect(await overflowsSideways(page, ".level-sheet .sheet-card")).toBe(false);
    await page.screenshot({ path: "test-results/levels-sheet.png" });

    // A neighbor opens the same chip: her levels, and nothing of her points or her day.
    await signIn(page, neighbor);
    await page.goto(`/r/${linden.id}`);
    await expect(chip).toHaveText("Level 2");
    await chip.click();
    await expect(skills.getByRole("heading", { name: "Linden's skills" })).toBeVisible();
    await expect(making).toContainText("Making 2");
    await expect(making.getByRole("progressbar")).toBeVisible();
    await expect(skills.locator(".level-total")).toHaveText("Level 2");
    await expect(skills).not.toContainText("points");
    await expect(skills).not.toContainText("today");
    await expect(skills.locator(".level-titles, .level-wear")).toHaveCount(0);
    expect(await overflowsSideways(page, ".level-sheet .sheet-card")).toBe(false);
  });
  expect(errors).toEqual([]);
});
