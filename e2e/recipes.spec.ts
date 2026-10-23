import { expect, type Page, test } from "@playwright/test";
import {
  act,
  actFirmly,
  freePlots,
  overflowsSideways,
  persona,
  read,
  settleFree,
  signIn,
  tapTile,
  walkTo,
  watchErrors,
} from "./support";

/**
 * Recipes you learn (RFC 0024) on a phone. Yarrow's first kitchen asks her to pick 3 recipes, the
 * kitchen then lists what she knows with how many more there are to learn, and that link opens the
 * shop's Recipes shelf, where she takes a free pick, buys a card, and is turned down for one she can
 * no longer afford, in the server's words. Then Primrose, standing by Hyssop on the Commons, taps her and
 * teaches her lemonade: both hear it, and Hyssop finds it at her own kitchen and sees on Primrose's
 * profile what else Primrose can teach her. Last, levels (RFC 0029): Celandine's first chair shows its
 * points over her figure, her first fishing rod takes her to Making 2 and level 2 with a toast, and
 * the chip on her profile opens her skills, which Yarrow sees without the points.
 */

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

type Who = Awaited<ReturnType<typeof persona>>;
let yarrow: Who | undefined;

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
  yarrow = await persona(page.request, "stocked", { name: "Yarrow", coins: 100 });
  expect((await read(page.request, yarrow.token, "/v1/inventory")).inventory.recipePicks).toBe(3);
  await kitchenBy(page, yarrow);

  await signIn(page, yarrow);
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
  await expect(learn).toHaveText("15 more recipes to learn");
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
  // Walk her to the counter here, not in the next test: a card is bought at the shop in this world
  // (RFC 0042), and the walk spends action tokens that the next test's taps then need. A free pick
  // needs no walk, which is why the picks above worked from her kitchen.
  const counter = (await read(page.request, yarrow.token, "/v1/shop")).you.counter;
  const world = await (await page.request.get("/v1/world")).json();
  await walkTo(page.request, yarrow, counter, world.config.reach);
  expect(errors).toEqual([]);
});

test("she buys a card once her picks are used, and a card she can't afford says why", async ({
  page,
}) => {
  if (!yarrow) throw new Error("The first test makes Yarrow");
  const errors = watchErrors(page);
  // Her last free pick, over the API.
  expect(
    (await act(page.request, yarrow.token, { type: "pick_recipe", recipe: "flower_box" })).ok,
  ).toBe(true);
  // The first test left her at the shop's counter, which this world's card buys need.
  expect((await read(page.request, yarrow.token, "/v1/shop")).you.away).toBeUndefined();
  await signIn(page, yarrow);
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
  let balance = (await read(page.request, yarrow.token, "/v1/shop")).you.balance as number;
  const cheap = ["barrel", "bookshelf", "lamp_post", "signpost", "fried_minnows", "fish_stew"];
  while (balance >= 35) {
    const card = cheap.shift();
    if (!card) throw new Error("Ran out of cards to spend on");
    const bought = await actFirmly(page.request, yarrow.token, {
      type: "shop_buy",
      sku: `recipe:${card}`,
      count: 1,
    });
    expect(bought.ok, `buying ${card}: ${JSON.stringify(bought.error ?? {})}`).toBe(true);
    balance = (await read(page.request, yarrow.token, "/v1/shop")).you.balance;
  }
  const why = await actFirmly(page.request, yarrow.token, {
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
  // Two newcomers on the Commons. Hyssop steps off the spawn tile, so a tap on her is a tap on her.
  const primrose = await persona(page.request, "visitor", { name: "Primrose" });
  const hyssop = await persona(page.request, "visitor", { name: "Hyssop" });
  expect(
    (await act(page.request, primrose.token, { type: "pick_recipe", recipe: "lemonade" })).ok,
  ).toBe(true);
  let step: { dx: number; dy: number } | undefined;
  for (const [dir, dx, dy] of [
    ["e", 1, 0],
    ["w", -1, 0],
    ["s", 0, 1],
    ["n", 0, -1],
  ] as const) {
    if ((await act(page.request, hyssop.token, { type: "move", dir })).ok) {
      step = { dx, dy };
      break;
    }
  }
  if (!step) throw new Error("Hyssop couldn't step off the spawn tile");
  // Primrose's own profile of Hyssop says what she could teach her.
  const seen = (await read(page.request, primrose.token, `/v1/residents/${hyssop.id}`)).resident;
  expect(seen.canLearn).toEqual(["lemonade"]);

  // Hyssop watches the world on her own phone.
  const hyssopSide = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hyssopPage = await hyssopSide.newPage();
  const hyssopErrors = watchErrors(hyssopPage);
  await signIn(hyssopPage, hyssop);
  await hyssopPage.goto("/world");
  await expect(hyssopPage.locator("#hud")).toBeVisible();

  // Primrose taps Hyssop: her sheet lists what Primrose could teach her, with Teach.
  await signIn(page, primrose);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, step.dx, step.dy);
  const sheet = page.locator(".teach-sheet");
  await expect(sheet.getByRole("heading", { name: "Hyssop", exact: true })).toBeVisible();
  const lemonade = sheet.locator('[data-recipe="lemonade"]');
  await expect(lemonade.locator("svg.item-art")).toBeVisible();
  await page.screenshot({ path: "test-results/recipes-teach.png" });
  await lemonade.getByRole("button", { name: "Teach Hyssop lemonade" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#toast")).toContainText("You taught Hyssop lemonade.");
  // Hyssop hears it with Primrose's name, and the notification says so too.
  await expect(hyssopPage.locator("#toast")).toContainText("Primrose taught you lemonade.");
  const notes = (await read(page.request, hyssop.token, "/v1/notifications")).notifications;
  expect(notes[0]).toMatchObject({ type: "recipe_taught", recipe: "lemonade" });

  // Hyssop settles a plot of her own, uses her picks, and puts a kitchen up: lemonade is there.
  await settleFree(page.request, hyssop.token, await freePlots(page.request, 5, "top-right"));
  for (const recipe of ["well", "barrel", "signpost"]) {
    expect((await act(page.request, hyssop.token, { type: "pick_recipe", recipe })).ok).toBe(true);
  }
  await kitchenBy(hyssopPage, hyssop);
  await hyssopPage.reload();
  await expect(hyssopPage.locator("#hud")).toBeVisible();
  await tapTile(hyssopPage, 1, -1);
  const kitchen = hyssopPage.locator(".workshop-sheet");
  await expect(kitchen.locator(".workshop-row", { hasText: "Lemonade" })).toHaveCount(1);
  await expect(kitchen.locator(".workshop-row", { hasText: "Tomato sauce" })).toHaveCount(0);

  // Primrose picks the bookshelf, and her profile tells Hyssop she can teach it.
  expect(
    (await act(page.request, primrose.token, { type: "pick_recipe", recipe: "bookshelf" })).ok,
  ).toBe(true);
  await hyssopPage.goto(`/r/${primrose.id}`);
  await expect(hyssopPage.locator(".profile-teach")).toHaveText(
    "Primrose can teach you bookshelf.",
  );
  await hyssopPage.screenshot({ path: "test-results/recipes-can-teach.png" });
  expect(errors).toEqual([]);
  expect(hyssopErrors).toEqual([]);
  await hyssopSide.close();
});

test("a newcomer's first two makes reach level 2, and her profile shows it", async ({ page }) => {
  if (!yarrow) throw new Error("The first test makes Yarrow");
  const errors = watchErrors(page);
  const neighbor = yarrow;
  await test.step("her first chair and fishing rod, and the chip on her profile", async () => {
    const celandine = await persona(page.request, "stocked", { name: "Celandine" });
    // Her free picks, over the API, so the workbench opens on its own sheet.
    for (const recipe of ["well", "barrel", "signpost"]) {
      expect((await act(page.request, celandine.token, { type: "pick_recipe", recipe })).ok).toBe(
        true,
      );
    }
    await kitchenBy(page, celandine, "workbench");
    await signIn(page, celandine);
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
    await page.goto(`/r/${celandine.id}`);
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
    await page.goto(`/r/${celandine.id}`);
    await expect(chip).toHaveText("Level 2");
    await chip.click();
    await expect(skills.getByRole("heading", { name: "Celandine's skills" })).toBeVisible();
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
