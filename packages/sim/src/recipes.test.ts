import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { RECIPE_NAMES, type RecipeName } from "./catalog";
import { treasuryShareOf } from "./economy";
import { LESSONS_CONFIG, LESSONS_HASH, LESSONS_LOG } from "./fixtures/lessons-log";
import {
  PAGE_EDITION_CONFIG,
  PAGE_EDITION_HASH,
  PAGE_EDITION_LOG,
} from "./fixtures/page-edition-log";
import { RECIPES_CONFIG, RECIPES_HASH, RECIPES_LOG } from "./fixtures/recipes-log";
import { SHOP_CONFIG, SHOP_LOG } from "./fixtures/shop-log";
import { gatherableAt, nearestOpenPickup, pickupLeft } from "./gather";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize } from "./items";
import { isPotKind, isPotteryRecipe } from "./pottery";
import {
  BASE_RECIPES,
  CARD_RECIPES,
  CARD_SKUS,
  cardSeason,
  HOLIDAY_RECIPES,
  knownRecipes,
  knows,
  onShelf,
  PAGE_EDITIONS,
  PAGE_RECIPES,
  pageEditionOf,
  pageOn,
  picksLeft,
  RECIPES_RULES,
  recipeCardPrice,
  shelfOn,
  taughtToday,
  teachable,
  teachingToday,
} from "./recipes";
import { replay } from "./replay";
import { dayOfDate, seasonOf, seasonSpan } from "./season";
import { BUY_ORDERS, buySeason, type SellKind, townBuys } from "./shop";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1,1). Settling lands on the plot's center, where the
// starter home puts its hearth: (3, 3) on plot (0, 0), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PLOTS = [
  [0, 0],
  [2, 0],
  [0, 2],
  [2, 2],
] as const;
/** October 4, 2024: autumn, so pumpkin pie and soup are on the shelf and hot punch isn't. */
const DAY = 20_000;
const SUMMER = dayOfDate(2025, 7, 1);

/**
 * A world where every input checks the supply identity afterwards, and every rejection checks that
 * nothing changed at all.
 */
function world() {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    expectSupplyHolds(state);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refused = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? { code: null, message: "" } : result.rejection;
  };
  const code = (actor: string, command: Command) => refused(actor, command).code;
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  const coins = (id: string) => state.economy?.coins[id] ?? 0;
  return { state, send, ok, refused, code, town, settle, coins };
}

/**
 * Days, coins, items, and the shop open, with Ada settled before recipes open and Cy after, both
 * with a kitchen and a workbench beside their hearths.
 */
function opened(day = DAY) {
  const w = world();
  w.town({ type: "new_day", day });
  w.town({ type: "open_economy" });
  w.town({ type: "open_items" });
  w.town({ type: "open_shop" });
  w.settle("ada", 0);
  w.town({ type: "open_recipes" });
  w.settle("cy", 2);
  // Hearths: Ada's at (3, 3), Cy's at (3, 19).
  w.ok("ada", { type: "place", x: 4, y: 2, block: "kitchen" });
  w.ok("ada", { type: "place", x: 4, y: 3, block: "workbench" });
  w.ok("cy", { type: "place", x: 4, y: 18, block: "kitchen" });
  w.ok("cy", { type: "place", x: 4, y: 19, block: "workbench" });
  return w;
}

const LEMONADE: Command = { type: "craft", recipe: "lemonade", x: 4, y: 18 };

describe("old logs", () => {
  it("have no recipes until open_recipes", () => {
    expect(replay(SHOP_CONFIG, SHOP_LOG).recipes).toBeUndefined();
  });

  it("replay the recipes log to its pinned hash", () => {
    const state = replay(RECIPES_CONFIG, RECIPES_LOG);
    expect(hashWorld(state)).toBe(RECIPES_HASH);
    expectSupplyHolds(state);
    expect(state.recipes?.everything).toEqual(["ada", "bob", "clem", "cy", "dee"]);
    expect(state.recipes?.learned).toEqual({
      eve: ["herb_sachet", "lemonade", "pumpkin_pie", "well"],
    });
    expect(state.recipes?.picks).toEqual({ eve: 3 });
  });
});

describe("the lessons log", () => {
  it("replays lessons, a townsfolk's lesson, and a recipe page to its pinned hash", () => {
    const state = replay(LESSONS_CONFIG, LESSONS_LOG);
    expect(hashWorld(state)).toBe(LESSONS_HASH);
    expectSupplyHolds(state);
    expect(state.recipes?.learned).toMatchObject({
      fran: ["lemonade", "pumpkin_pie", "well"],
      gus: ["lemonade", "tomato_sauce"],
    });
    expect(state.recipes?.townsfolkTaught).toEqual({ gus: DAY + 18 });
    // The page went into nobody's things, and the day after, nothing is counted.
    expect(state.items?.inventories.fran?.stacks ?? {}).not.toHaveProperty("recipe_page");
    expect(state.items?.today.taught).toBeUndefined();
  });
});

describe("the page edition log", () => {
  it("replays the switch and a page only edition 2 has, to its pinned hash", () => {
    const state = replay(PAGE_EDITION_CONFIG, PAGE_EDITION_LOG);
    expect(hashWorld(state)).toBe(PAGE_EDITION_HASH);
    expectSupplyHolds(state);
    expect(state.recipes?.pages).toBe(2);
    // The page Fran gathered at (14, 7) is a page only under edition 2: edition 1 has no page
    // there at all, so the switch is what put it on the ground.
    expect(pageOn(14, 7, 20_027, 1)).toBeNull();
    expect(pageOn(14, 7, 20_027, 2)).toBe("corn_bread");
    expect(state.recipes?.learned.fran).toContain("corn_bread");
  });
});

describe("set_page_edition", () => {
  it("comes from the town, moves forward only, and turns on the wider list", () => {
    // Before recipes are learned there is no edition to set.
    expect(world().code(TOWN_ACTOR, { type: "set_page_edition", edition: 2 })).toBe("not_due");
    const w = opened();
    expect(pageEditionOf(w.state)).toBe(1);
    // An edition that doesn't exist, the one in use, and anyone but the town are all refused.
    expect(w.code(TOWN_ACTOR, { type: "set_page_edition", edition: 4 })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "set_page_edition", edition: 0 })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "set_page_edition", edition: 1 })).toBe("already_set");
    expect(w.code("ada", { type: "set_page_edition", edition: 2 })).toBe("server_only");
    // The switch sets the edition and says so, and it never goes back.
    expect(w.town({ type: "set_page_edition", edition: 2 })).toEqual([
      { type: "page_edition_set", edition: 2 },
    ]);
    expect(pageEditionOf(w.state)).toBe(2);
    expect(w.code(TOWN_ACTOR, { type: "set_page_edition", edition: 1 })).toBe("server_only");
  });

  it("widens the list without moving edition 1's pages", () => {
    // Edition 1 is frozen: every tile it called a page it still calls a page, teaching the same
    // recipe, whatever edition 2 holds.
    expect([pageOn(0, 2, DAY, 1), pageOn(8, 1, DAY, 1), pageOn(2, 0, DAY, 1)]).toEqual([
      "lemonade",
      "flower_wreath",
      "well",
    ]);
    const edition = (n: number) => [...(PAGE_EDITIONS[n] ?? [])];
    expect(edition(1)).toEqual([...PAGE_RECIPES]);
    // Edition 2 is edition 1 and the ten cards the new crops brought, and edition 3 is edition 2
    // and the cozy pieces' cards (RFC 0044), so each widens the last and every card is a page.
    expect(edition(2).slice(0, PAGE_RECIPES.length)).toEqual([...PAGE_RECIPES]);
    expect(edition(3).slice(0, edition(2).length)).toEqual(edition(2));
    // The pots' cards (RFC 0047) came after edition 3, so they're no page until an edition of their own.
    expect(edition(3).sort()).toEqual(CARD_RECIPES.filter((r) => !isPotKind(r)).sort());
  });
});

describe("the recipe lists", () => {
  it("names a family recipe once, by its id", () => {
    expect(RECIPE_NAMES).toContain("jam");
    expect(RECIPE_NAMES.some((r) => r.endsWith("_jam"))).toBe(false);
    expect(new Set(RECIPE_NAMES).size).toBe(RECIPE_NAMES.length);
  });

  it("has the base RFC 0024 sets out", () => {
    expect([...BASE_RECIPES]).toEqual([
      "herb_tea",
      "jam",
      "bouquet",
      "chair",
      "table",
      "stone_wall",
      "fishing_rod",
    ]);
  });

  it("knows the holiday recipes from the catalog's marks", () => {
    expect([...HOLIDAY_RECIPES].sort()).toEqual([
      "candy",
      "candy_cane",
      "gelt",
      "jack_o_lantern",
      "sufganiyah",
    ]);
  });

  it("sells a card for every other recipe", () => {
    expect([...CARD_RECIPES].sort()).toEqual(
      [
        "barrel",
        "bookshelf",
        "campfire",
        "cranberry_punch",
        "fish_stew",
        "flower_box",
        "flower_wreath",
        "fried_minnows",
        "herb_sachet",
        "lamp_post",
        "lemonade",
        "pumpkin_pie",
        "pumpkin_soup",
        "signpost",
        "tomato_sauce",
        "well",
        "apple_pie",
        "apple_cider",
        "berry_crumble",
        "fruit_salad",
        "grape_juice",
        "pickles",
        "corn_bread",
        "harvest_soup",
        "garden_salad",
        "posy",
        "armchair",
        "sofa",
        "bed",
        "vase",
        "teapot",
      ].sort(),
    );
    expect(CARD_SKUS).toContain("recipe:well");
    for (const recipe of RECIPE_NAMES) {
      const everyone = (BASE_RECIPES as readonly string[]).includes(recipe);
      const holiday = HOLIDAY_RECIPES.includes(recipe);
      // The bowl and a pot of tea are everyone's once clay is out (RFC 0047), so neither has a card.
      const clay = recipe === "bowl" || recipe === "pot_of_tea";
      expect(CARD_RECIPES.includes(recipe), recipe).toBe(!everyone && !holiday && !clay);
    }
  });
});

describe("recipeCardPrice", () => {
  it("prices every card as RFC 0024's table does", () => {
    const prices = Object.fromEntries(CARD_RECIPES.map((r) => [r, recipeCardPrice(r)]));
    expect(prices).toEqual({
      lemonade: 20,
      tomato_sauce: 30,
      fried_minnows: 20,
      fish_stew: 20,
      pumpkin_pie: 50,
      pumpkin_soup: 40,
      cranberry_punch: 40,
      herb_sachet: 15,
      flower_wreath: 30,
      flower_box: 20,
      signpost: 15,
      barrel: 20,
      bookshelf: 20,
      lamp_post: 20,
      campfire: 25,
      well: 35,
      apple_pie: 20,
      apple_cider: 20,
      berry_crumble: 20,
      fruit_salad: 20,
      grape_juice: 20,
      vase: 20,
      teapot: 25,
      pickles: 25,
      corn_bread: 20,
      harvest_soup: 20,
      garden_salad: 20,
      posy: 20,
      // The cozy pieces (RFC 0044): wood and cushions, priced like any furniture card.
      armchair: 20,
      sofa: 25,
      bed: 30,
    });
  });

  it("keeps the numbers RFC 0024 records", () => {
    expect(RECIPES_RULES).toEqual({
      starterPicks: 3,
      rotationTimes: 5,
      seasonTimes: 8,
      plainCoins: 10,
      perThing: 3,
      roundTo: 5,
      teachPerDay: 1,
      taughtPerDay: 1,
      townsfolkEveryDays: 7,
      pageOneIn: 20,
    });
  });

  it("pays back every card for a good the town buys in 5 to 30 days of selling", () => {
    const sold = CARD_RECIPES.filter((r) => Object.hasOwn(BUY_ORDERS, r)) as SellKind[];
    expect(sold.length).toBeGreaterThan(0);
    // A year of days from the first of a spring, so every season counts once.
    const start = seasonSpan(dayOfDate(2025, 3, 1)).start;
    for (const recipe of sold) {
      const { price, perDay } = BUY_ORDERS[recipe];
      const season = buySeason(recipe);
      const days = Array.from({ length: 365 }, (_, i) => start + i).filter(
        (d) => season === undefined || seasonOf(d) === season,
      );
      // How often the town buys it, on the days it could: about 3 in 8 for the rotation, every day
      // of its season for a season's buys.
      const often = days.filter((d) => townBuys(d).includes(recipe)).length / days.length;
      const payback = recipeCardPrice(recipe as RecipeName) / (price * perDay * often);
      expect(payback, recipe).toBeGreaterThanOrEqual(5);
      expect(payback, recipe).toBeLessThanOrEqual(30);
    }
  });
});

describe("the Recipes shelf", () => {
  it("has a season's cards only in their season", () => {
    expect(cardSeason("pumpkin_pie")).toBe("autumn");
    expect(cardSeason("cranberry_punch")).toBe("winter");
    expect(cardSeason("lemonade")).toBeUndefined();
    expect(cardSeason("well")).toBeUndefined();
    expect(shelfOn(DAY)).toContain("pumpkin_pie");
    expect(shelfOn(DAY)).not.toContain("cranberry_punch");
    expect(shelfOn(SUMMER)).not.toContain("pumpkin_pie");
    expect(onShelf("cranberry_punch", dayOfDate(2024, 12, 1))).toBe(true);
    expect(onShelf("herb_tea", DAY)).toBe(false);
  });
});

describe("open_recipes", () => {
  it("needs the server and the shop, and opens once with everyone here now", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.settle("bob", 1);
    w.settle("ada", 0);
    expect(w.code("ada", { type: "open_recipes" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "open_recipes" })).toBe("not_due");
    w.town({ type: "open_shop" });
    expect(w.town({ type: "open_recipes" })).toEqual([{ type: "recipes_opened" }]);
    expect(w.code(TOWN_ACTOR, { type: "open_recipes" })).toBe("already_open");
    expect(w.state.recipes).toEqual({
      everything: ["ada", "bob"],
      learned: {},
      picks: {},
      townsfolkTaught: {},
    });
  });
});

/** Every recipe but pottery's, sorted: what knowing everything means before clay is out. */
const NO_POTS = RECIPE_NAMES.filter((r) => !isPotteryRecipe(r)).sort();

describe("knows", () => {
  it("says yes to everyone, for everything, before open_recipes", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.settle("ada", 0);
    // Every recipe but the pots, which nobody knows before clay is out (RFC 0047).
    for (const recipe of RECIPE_NAMES) {
      expect(knows(w.state, "ada", recipe), recipe).toBe(!isPotteryRecipe(recipe));
    }
    expect(knownRecipes(w.state, "ada")).toEqual(NO_POTS);
    expect(picksLeft(w.state, "ada")).toBe(0);
  });

  it("gives a newcomer the base and the holiday recipes, and 3 free picks", () => {
    const w = opened();
    expect(knownRecipes(w.state, "cy")).toEqual([...BASE_RECIPES, ...HOLIDAY_RECIPES].sort());
    expect(picksLeft(w.state, "cy")).toBe(3);
    for (const recipe of CARD_RECIPES) expect(knows(w.state, "cy", recipe)).toBe(false);
  });

  it("keeps every recipe for residents who lived here when recipes opened, even one added later", () => {
    const w = opened();
    expect(knownRecipes(w.state, "ada")).toEqual(NO_POTS);
    expect(picksLeft(w.state, "ada")).toBe(0);
    // A recipe the catalog adds later is a card, and residents in `everything` know it too.
    const later = "honey_cake" as RecipeName;
    expect(knows(w.state, "ada", later)).toBe(true);
    expect(knows(w.state, "cy", later)).toBe(false);
  });

  it("gives townsfolk every recipe, by rule", () => {
    const w = opened();
    w.settle("clem", 3);
    expect(knows(w.state, "clem", "well")).toBe(false);
    w.town({ type: "set_townsfolk", ids: ["clem"] });
    expect(knownRecipes(w.state, "clem")).toEqual(NO_POTS);
    expect(picksLeft(w.state, "clem")).toBe(0);
  });
});

describe("craft", () => {
  it("refuses a recipe you don't know, saying how to learn it, and takes nothing", () => {
    const w = opened();
    stock(w.state, "cy", { lemon: 2, sugar: 1, jar: 1 });
    const held = { ...w.state.items?.inventories.cy?.stacks };
    const { code, message } = w.refused("cy", LEMONADE);
    expect(code).toBe("recipe_unknown");
    expect(message).toContain("pick_recipe");
    expect(message).toContain("20 coins, shop_buy with sku recipe:lemonade");
    expect(message).toContain("ask a neighbor who knows it to teach you");
    expect(message).toContain("recipe page");
    expect(w.state.items?.inventories.cy?.stacks).toEqual(held);
    expect(w.state.items?.today.crafted.cy).toBeUndefined();
  });

  it("checks its own rules first, so a short craft says what's short", () => {
    const w = opened();
    expect(w.code("cy", LEMONADE)).toBe("not_enough_items");
    expect(w.code("cy", { ...LEMONADE, x: 4, y: 19 })).toBe("no_station");
  });

  it("names when a seasonal card is back, and leaves out picks once they're used", () => {
    const w = opened(SUMMER);
    stock(w.state, "cy", { pumpkin: 2, sugar: 1 });
    const { message } = w.refused("cy", { type: "craft", recipe: "pumpkin_pie", x: 4, y: 18 });
    expect(message).toContain("only in autumn");
    expect(message).toContain("shop_buy with sku recipe:pumpkin_pie");
    for (const recipe of ["lemonade", "well", "barrel"]) {
      w.ok("cy", { type: "pick_recipe", recipe });
    }
    stock(w.state, "cy", { tomato: 3, herb: 1, jar: 1 });
    const used = w.refused("cy", { type: "craft", recipe: "tomato_sauce", x: 4, y: 18 });
    expect(used.code).toBe("recipe_unknown");
    expect(used.message).not.toContain("pick_recipe");
    expect(used.message).toContain("Buy its card at the town shop (30 coins");
  });

  it("makes the base, the holiday recipes, and a jam of any fruit for a newcomer", () => {
    const w = opened();
    stock(w.state, "cy", { herb: 3, jar: 2, strawberry: 3, sugar: 2, pumpkin: 1 });
    w.ok("cy", { type: "craft", recipe: "herb_tea", x: 4, y: 18 });
    w.ok("cy", { type: "craft", recipe: "strawberry_jam", x: 4, y: 18 });
    w.ok("cy", { type: "craft", recipe: "candy", x: 4, y: 18 });
  });

  it("makes anything for a resident who lived here when recipes opened", () => {
    const w = opened();
    stock(w.state, "ada", { wood: 2, stone: 6 });
    w.ok("ada", { type: "craft", recipe: "well", x: 4, y: 3 });
  });

  it("makes what you picked and what you bought", () => {
    const w = opened();
    stock(w.state, "cy", { lemon: 2, sugar: 1, jar: 1, wood: 2, stone: 6 });
    w.ok("cy", { type: "pick_recipe", recipe: "lemonade" });
    w.ok("cy", LEMONADE);
    fund(w.state, "cy", 35);
    w.ok("cy", { type: "shop_buy", sku: "recipe:well" });
    w.ok("cy", { type: "craft", recipe: "well", x: 4, y: 19 });
  });
});

describe("pick_recipe", () => {
  it("learns a card from today's shelf, and runs out at 3", () => {
    const w = opened();
    expect(w.ok("cy", { type: "pick_recipe", recipe: "lemonade" })).toEqual([
      { type: "recipe_learned", residentId: "cy", recipe: "lemonade", how: "picked" },
    ]);
    w.ok("cy", { type: "pick_recipe", recipe: "pumpkin_pie" });
    expect(picksLeft(w.state, "cy")).toBe(1);
    w.ok("cy", { type: "pick_recipe", recipe: "barrel" });
    expect(picksLeft(w.state, "cy")).toBe(0);
    expect(w.code("cy", { type: "pick_recipe", recipe: "well" })).toBe("no_picks_left");
    // A card off the shelf can't be bought today either, so the refusal says when it's back.
    const { code, message } = w.refused("cy", { type: "pick_recipe", recipe: "cranberry_punch" });
    expect(code).toBe("no_picks_left");
    expect(message).toContain("only in winter, which starts on December 1");
    expect(message).not.toContain("instead");
    expect(w.state.recipes?.learned.cy).toEqual(["barrel", "lemonade", "pumpkin_pie"]);
    expect(w.state.recipes?.picks.cy).toBe(3);
    expect(knows(w.state, "cy", "barrel")).toBe(true);
  });

  it("refuses a recipe you know: picked, bought, the base, a holiday's, or every one", () => {
    const w = opened();
    w.ok("cy", { type: "pick_recipe", recipe: "lemonade" });
    expect(w.code("cy", { type: "pick_recipe", recipe: "lemonade" })).toBe("already_known");
    expect(w.code("cy", { type: "pick_recipe", recipe: "jam" })).toBe("already_known");
    expect(w.code("cy", { type: "pick_recipe", recipe: "candy_cane" })).toBe("already_known");
    expect(w.code("ada", { type: "pick_recipe", recipe: "well" })).toBe("already_known");
    fund(w.state, "cy", 20);
    w.ok("cy", { type: "shop_buy", sku: "recipe:barrel" });
    expect(w.code("cy", { type: "pick_recipe", recipe: "barrel" })).toBe("already_known");
    expect(picksLeft(w.state, "cy")).toBe(2);
  });

  it("refuses what isn't on the shelf today, and what isn't a recipe", () => {
    const w = opened();
    expect(w.code("cy", { type: "pick_recipe", recipe: "cranberry_punch" })).toBe("out_of_season");
    expect(w.code("cy", { type: "pick_recipe", recipe: "lemon_jam" })).toBe("unknown_item");
    expect(w.code("cy", { type: "pick_recipe", recipe: "nonsense" })).toBe("unknown_item");
    expect(w.code("cy", { type: "pick_recipe", recipe: "__proto__" })).toBe("unknown_item");
    expect(picksLeft(w.state, "cy")).toBe(3);
  });

  it("has nothing to pick before recipes open", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.settle("ada", 0);
    expect(w.code("ada", { type: "pick_recipe", recipe: "lemonade" })).toBe("already_known");
  });
});

describe("recipe cards", () => {
  it("move the card's price out of the purse, the shop's share to the treasury, and burn the rest", () => {
    const w = opened();
    fund(w.state, "cy", 40);
    const econ = w.state.economy;
    const before = { coins: w.coins("cy"), treasury: econ?.treasury, burned: econ?.burned };
    const share = treasuryShareOf(w.state);
    const events = w.ok("cy", { type: "shop_buy", sku: "recipe:tomato_sauce" });
    const toTreasury = Math.floor((30 * share) / 100);
    expect(w.coins("cy")).toBe(before.coins - 30);
    expect(econ?.treasury).toBe((before.treasury ?? 0) + toTreasury);
    expect(econ?.burned).toBe((before.burned ?? 0) + 30 - toTreasury);
    expect(events.at(-1)).toEqual({
      type: "recipe_learned",
      residentId: "cy",
      recipe: "tomato_sauce",
      how: "bought",
      price: 30,
    });
    expect(knows(w.state, "cy", "tomato_sauce")).toBe(true);
    // Cards aren't things: nothing went into Cy's things.
    expect(w.state.items?.inventories.cy?.goods ?? []).toEqual([]);
  });

  it("can't be bought twice: a known card is refused and no coins move", () => {
    const w = opened();
    fund(w.state, "cy", 100);
    w.ok("cy", { type: "shop_buy", sku: "recipe:well" });
    const left = w.coins("cy");
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:well" })).toBe("already_known");
    expect(w.coins("cy")).toBe(left);
    w.ok("cy", { type: "pick_recipe", recipe: "lemonade" });
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:lemonade" })).toBe("already_known");
    fund(w.state, "ada", 100);
    const ada = w.coins("ada");
    expect(w.code("ada", { type: "shop_buy", sku: "recipe:well" })).toBe("already_known");
    expect(w.coins("ada")).toBe(ada);
  });

  it("refuses without enough coins, and no coins move", () => {
    const w = opened();
    w.ok("cy", { type: "shop_buy", sku: "recipe:pumpkin_pie" });
    const have = w.coins("cy");
    expect(have).toBeLessThan(recipeCardPrice("well"));
    const treasury = w.state.economy?.treasury;
    const burned = w.state.economy?.burned;
    const { code, message } = w.refused("cy", { type: "shop_buy", sku: "recipe:well" });
    expect(code).toBe("not_enough_coins");
    expect(message).toContain("35 coins");
    expect(w.coins("cy")).toBe(have);
    expect(w.state.economy?.treasury).toBe(treasury);
    expect(w.state.economy?.burned).toBe(burned);
    expect(knows(w.state, "cy", "well")).toBe(false);
  });

  it("are refused to townsfolk, out of season, more than one at a time, and by a wrong name", () => {
    const w = opened();
    w.settle("clem", 3);
    fund(w.state, "clem", 100);
    w.town({ type: "set_townsfolk", ids: ["clem"] });
    expect(w.code("clem", { type: "shop_buy", sku: "recipe:well" })).toBe("not_eligible");
    fund(w.state, "cy", 100);
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:cranberry_punch" })).toBe("out_of_season");
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:well", count: 2 })).toBe("invalid_amount");
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:jam" })).toBe("unknown_item");
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:herb_tea" })).toBe("unknown_item");
    expect(w.code("cy", { type: "shop_buy", sku: "recipe:__proto__" })).toBe("unknown_item");
    w.ok("cy", { type: "shop_buy", sku: "recipe:well", count: 1 });
  });

  it("aren't sold before recipes open", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.town({ type: "open_shop" });
    w.settle("ada", 0);
    fund(w.state, "ada", 100);
    expect(w.code("ada", { type: "shop_buy", sku: "recipe:well" })).toBe("unknown_item");
  });
});

/** A teach command. */
const teach = (recipe: string, to: string): Command => ({ type: "teach", recipe, to });

/**
 * Recipes open, and Dee and Eve join after: both land on the Commons' spawn tile, so they stand
 * within reach of each other. Dee picks lemonade and the well.
 */
function lesson(day = DAY) {
  const w = opened(day);
  w.ok("dee", { type: "join", name: "Dee", kind: "human" });
  w.ok("eve", { type: "join", name: "Eve", kind: "human" });
  w.ok("dee", { type: "pick_recipe", recipe: "lemonade" });
  w.ok("dee", { type: "pick_recipe", recipe: "well" });
  return w;
}

describe("teach", () => {
  it("teaches a neighbor within reach a recipe you know, in one private event", () => {
    const w = lesson();
    expect(teachable(w.state, "dee", "eve")).toEqual(["lemonade", "well"]);
    expect(w.ok("dee", teach("lemonade", "eve"))).toEqual([
      { type: "recipe_learned", residentId: "eve", recipe: "lemonade", how: "taught", from: "dee" },
    ]);
    expect(knows(w.state, "eve", "lemonade")).toBe(true);
    expect(w.state.recipes?.learned.eve).toEqual(["lemonade"]);
    expect(teachingToday(w.state, "dee")).toBe(1);
    expect(taughtToday(w.state, "eve")).toBe(1);
    // A lesson costs nobody a pick, a coin, or a thing.
    expect(picksLeft(w.state, "eve")).toBe(3);
    expect(picksLeft(w.state, "dee")).toBe(1);
    expect(teachable(w.state, "dee", "eve")).toEqual(["well"]);
  });

  it("lets anyone who knows everything teach, and teaches nobody who knows it already", () => {
    const w = lesson();
    w.ok("ada", { type: "move", dir: "s" });
    expect(w.code("ada", teach("well", "eve"))).toBe("out_of_reach");
    expect(w.code("dee", teach("lemonade", "ada"))).toBe("already_known");
    expect(teachable(w.state, "dee", "ada")).toEqual([]);
    // Every card but the pots', which wait for clay (RFC 0047).
    expect(teachable(w.state, "ada", "eve")).toHaveLength(
      CARD_RECIPES.filter((r) => !isPotKind(r)).length,
    );
  });

  it("is one a day each way: one lesson given, one taught, and both come back at new_day", () => {
    const w = lesson();
    w.ok("fay", { type: "join", name: "Fay", kind: "human" });
    w.ok("fay", { type: "pick_recipe", recipe: "barrel" });
    w.ok("dee", teach("lemonade", "eve"));
    // Dee has taught today, and Eve has been taught today.
    expect(w.refused("dee", teach("well", "fay"))).toMatchObject({ code: "taught_today" });
    expect(w.refused("fay", teach("barrel", "eve"))).toMatchObject({ code: "taught_today" });
    w.town({ type: "new_day", day: DAY + 1 });
    expect(w.state.items?.today.teaching).toBeUndefined();
    expect(w.state.items?.today.taught).toBeUndefined();
    // Coming back the next day brings each of them back online where they were.
    w.ok("fay", teach("barrel", "eve"));
    w.ok("dee", teach("well", "fay"));
    expect(w.state.recipes?.learned).toMatchObject({
      eve: ["barrel", "lemonade"],
      fay: ["barrel", "well"],
    });
  });

  it("needs both of you online and within reach of each other", () => {
    const w = lesson();
    for (const _ of [1, 2, 3, 4]) w.ok("eve", { type: "move", dir: "e" });
    const far = w.refused("dee", teach("lemonade", "eve"));
    expect(far.code).toBe("out_of_reach");
    expect(far.message).toContain("Walk closer first: move e once.");
    w.ok("eve", { type: "move", dir: "w" });
    w.ok("eve", { type: "leave" });
    expect(w.code("dee", teach("lemonade", "eve"))).toBe("not_joined");
    w.ok("eve", { type: "join", name: "Eve", kind: "human" });
    w.ok("dee", teach("lemonade", "eve"));
  });

  it("refuses what you don't know, what everyone knows, yourself, and nobody", () => {
    const w = lesson();
    expect(w.code("dee", teach("barrel", "eve"))).toBe("recipe_unknown");
    expect(w.refused("dee", teach("barrel", "eve")).message).toContain("can't teach it");
    expect(w.code("dee", teach("herb_tea", "eve"))).toBe("already_known");
    expect(w.code("dee", teach("candy", "eve"))).toBe("already_known");
    expect(w.code("dee", teach("lemon_jam", "eve"))).toBe("unknown_item");
    expect(w.code("dee", teach("__proto__", "eve"))).toBe("unknown_item");
    expect(w.code("dee", teach("lemonade", "dee"))).toBe("already_known");
    expect(w.code("dee", teach("lemonade", "nobody"))).toBe("unknown_resident");
    expect(w.code("dee", teach("lemonade", "__proto__"))).toBe("unknown_resident");
    expect(w.code("dee", teach("lemonade", "toString"))).toBe("unknown_resident");
    expect(teachingToday(w.state, "dee")).toBe(0);
    expect(w.state.recipes?.learned.eve).toBeUndefined();
  });

  it("has nothing to teach before recipes open, when everyone knows everything", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.town({ type: "open_shop" });
    w.ok("dee", { type: "join", name: "Dee", kind: "human" });
    w.ok("eve", { type: "join", name: "Eve", kind: "human" });
    expect(w.code("dee", teach("lemonade", "eve"))).toBe("already_known");
    expect(teachable(w.state, "dee", "eve")).toEqual([]);
  });

  it("from a townsfolk, doesn't count against them, and comes to each resident once a week", () => {
    const w = lesson();
    w.ok("clem", { type: "join", name: "Clem", kind: "human" });
    w.town({ type: "set_townsfolk", ids: ["clem"] });
    w.ok("fay", { type: "join", name: "Fay", kind: "human" });
    expect(w.ok("clem", teach("tomato_sauce", "eve"))).toEqual([
      {
        type: "recipe_learned",
        residentId: "eve",
        recipe: "tomato_sauce",
        how: "taught",
        from: "clem",
      },
    ]);
    // Clem can teach someone else today, and Eve's lesson counts toward her day like any.
    w.ok("clem", teach("tomato_sauce", "fay"));
    expect(teachingToday(w.state, "clem")).toBe(0);
    expect(w.code("dee", teach("lemonade", "eve"))).toBe("taught_today");
    expect(w.state.recipes?.townsfolkTaught).toEqual({ eve: DAY, fay: DAY });
    // A neighbor can teach her the next day, but a townsfolk only a week after the last one.
    w.town({ type: "new_day", day: DAY + 1 });
    w.ok("dee", teach("lemonade", "eve"));
    w.town({ type: "new_day", day: DAY + 6 });
    const soon = w.refused("clem", teach("lemonade", "fay"));
    expect(soon).toMatchObject({ code: "taught_today" });
    expect(soon.message).toContain("once a week");
    w.town({ type: "new_day", day: DAY + 7 });
    w.ok("clem", teach("lemonade", "fay"));
    expect(w.state.recipes?.townsfolkTaught).toEqual({ eve: DAY, fay: DAY + 7 });
  });
});

describe("recipe pages", () => {
  it("are about one find in 20, every page recipe about as often, and pinned", () => {
    const counts: Record<string, number> = {};
    let pages = 0;
    let rolls = 0;
    for (let day = DAY; day < DAY + 28; day++) {
      for (let y = 0; y < 72; y++) {
        for (let x = 0; x < 72; x++) {
          rolls++;
          const recipe = pageOn(x, y, day);
          if (!recipe) continue;
          pages++;
          counts[recipe] = (counts[recipe] ?? 0) + 1;
        }
      }
    }
    const share = pages / rolls;
    expect(share).toBeGreaterThan(0.045);
    expect(share).toBeLessThan(0.055);
    expect(Object.keys(counts).sort()).toEqual([...PAGE_RECIPES].sort());
    for (const recipe of PAGE_RECIPES) {
      const want = pages / PAGE_RECIPES.length;
      expect(Math.abs((counts[recipe] ?? 0) - want), recipe).toBeLessThan(4 * Math.sqrt(want));
    }
    // A tile and a day give the page they always gave: a logged gather of one replays only while
    // `PAGE_RECIPES` keeps its length and its order, since the roll picks a place in it.
    expect([
      pageOn(0, 2, DAY),
      pageOn(8, 1, DAY),
      pageOn(49, 2, DAY),
      pageOn(4, 5, DAY),
      pageOn(2, 0, DAY),
      pageOn(13, 0, DAY),
      pageOn(1, 0, DAY),
    ]).toEqual([
      "lemonade",
      "flower_wreath",
      "pumpkin_soup",
      "lamp_post",
      "well",
      "fried_minnows",
      null,
    ]);
    expect(pages).toBe(7286);
  });

  it("are frozen to the cards they shipped with, never the base or a holiday's", () => {
    // A card added to the catalog later is no page until a new list starts at a logged switch, so
    // every logged gather of a page replays through exactly these, in this order.
    expect([...PAGE_RECIPES]).toEqual([
      "lemonade",
      "tomato_sauce",
      "herb_sachet",
      "flower_wreath",
      "pumpkin_pie",
      "pumpkin_soup",
      "bookshelf",
      "barrel",
      "signpost",
      "lamp_post",
      "well",
      "campfire",
      "flower_box",
      "cranberry_punch",
      "fried_minnows",
      "fish_stew",
    ]);
    for (const recipe of PAGE_RECIPES) {
      expect(CARD_RECIPES, recipe).toContain(recipe);
      expect((BASE_RECIPES as readonly string[]).includes(recipe), recipe).toBe(false);
      expect(HOLIDAY_RECIPES.includes(recipe), recipe).toBe(false);
    }
  });
});

/**
 * The first day from `DAY` with a recipe page lying east of the starter homes (x 8 and on, so a
 * walk from the Commons there meets no wall), where, and the find it would be without pages.
 */
function firstPage() {
  for (let day = DAY; day < DAY + 400; day++) {
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 8; x < CONFIG.width; x++) {
        if (gatherableAt(CONFIG, x, y, day, true, true) !== "recipe_page") continue;
        const find = gatherableAt(CONFIG, x, y, day, true, false);
        return { day, x, y, find, recipe: pageOn(x, y, day) as RecipeName };
      }
    }
  }
  throw new Error("no recipe page in 400 days");
}

/** Walk `id` one tile at a time, east or west and then north or south, onto (x, y). */
function walkOnto(w: ReturnType<typeof world>, id: string, to: { x: number; y: number }) {
  const at = () => w.state.residents[id] as { x: number; y: number };
  while (at().x !== to.x) w.ok(id, { type: "move", dir: at().x < to.x ? "e" : "w" });
  while (at().y !== to.y) w.ok(id, { type: "move", dir: at().y < to.y ? "s" : "n" });
}

describe("gathering a recipe page", () => {
  const page = firstPage();
  const at = { x: page.x, y: page.y };

  /** Recipes and finds open on the page's day, with Clem (townsfolk) and Eve standing on it. */
  function onPage() {
    const w = lesson(page.day);
    w.town({ type: "open_finds" });
    w.ok("clem", { type: "join", name: "Clem", kind: "human" });
    w.town({ type: "set_townsfolk", ids: ["clem"] });
    walkOnto(w, "clem", at);
    walkOnto(w, "eve", at);
    return w;
  }

  it("teaches its recipe, puts nothing in your things, and is gone for the day", () => {
    const w = onPage();
    expect(pickupLeft(w.state, page.x, page.y)).toBe("recipe_page");
    const things = { ...w.state.items?.inventories.eve?.stacks };
    expect(w.ok("eve", { type: "gather", ...at })).toEqual([
      { type: "gathered", ...at, kind: "recipe_page", by: "eve" },
      { type: "recipe_learned", residentId: "eve", recipe: page.recipe, how: "found" },
    ]);
    expect(knows(w.state, "eve", page.recipe)).toBe(true);
    expect({ ...w.state.items?.inventories.eve?.stacks }).toEqual(things);
    expect(pickupLeft(w.state, page.x, page.y)).toBeNull();
    expect(w.code("dee", { type: "gather", ...at })).toBe("out_of_reach");
  });

  it("is refused as already_known to someone who knows it, and stays for someone else", () => {
    const w = onPage();
    const known = w.refused("clem", { type: "gather", ...at });
    expect(known.code).toBe("already_known");
    expect(known.message).toContain("stays for someone else");
    // Gathering everything within reach leaves it too, and says so when it's all there is.
    const { reach } = CONFIG;
    const gathered = w.state.items?.gathered ?? {};
    for (let y = page.y - reach; y <= page.y + reach; y++) {
      for (let x = page.x - reach; x <= page.x + reach; x++) {
        if (x !== page.x || y !== page.y) gathered[`${x},${y}`] = page.day;
      }
    }
    if (w.state.items) w.state.items.gathered = gathered;
    const all = w.refused("clem", { type: "gather" });
    expect(all.code).toBe("already_known");
    expect(all.message).toContain("which you already know, so it stays for someone else");
    expect(pickupLeft(w.state, page.x, page.y)).toBe("recipe_page");
    // The next step a refusal names is never a page they know; for Eve it's this one.
    expect(nearestOpenPickup(w.state, "clem", at)).not.toEqual(at);
    expect(nearestOpenPickup(w.state, "eve", at)).toEqual(at);
    w.ok("eve", { type: "gather", ...at });
  });

  it("takes one page a recipe in a gather of everything: a second for the same recipe stays", () => {
    // The first day from DAY with two pages for one recipe within reach of one tile (found by
    // searching): fried minnows at (8, 7) and (7, 9), both reached from (8, 8).
    const day = 22_612;
    const first = { x: 8, y: 7 };
    const second = { x: 7, y: 9 };
    for (const t of [first, second]) {
      expect(gatherableAt(CONFIG, t.x, t.y, day, true, true)).toBe("recipe_page");
      expect(pageOn(t.x, t.y, day)).toBe("fried_minnows");
    }
    const w = lesson(day);
    w.town({ type: "open_finds" });
    walkOnto(w, "eve", { x: 8, y: 8 });
    const events = w.ok("eve", { type: "gather" });
    expect(events.filter((e) => e.type === "recipe_learned")).toEqual([
      { type: "recipe_learned", residentId: "eve", recipe: "fried_minnows", how: "found" },
    ]);
    expect(events).toContainEqual({ type: "gathered", ...first, kind: "recipe_page", by: "eve" });
    expect(events.some((e) => e.type === "gathered" && e.x === second.x && e.y === second.y)).toBe(
      false,
    );
    expect(pickupLeft(w.state, second.x, second.y)).toBe("recipe_page");
    expect(w.code("eve", { type: "gather", ...second })).toBe("already_known");
  });

  it("comes with everything else within reach, and takes no room in full things", () => {
    const w = onPage();
    stock(w.state, "eve", {
      stone: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.eve),
    });
    const events = w.ok("eve", { type: "gather" });
    expect(events).toContainEqual({ type: "gathered", ...at, kind: "recipe_page", by: "eve" });
    expect(events.at(-1)).toEqual({
      type: "recipe_learned",
      residentId: "eve",
      recipe: page.recipe,
      how: "found",
    });
    expect(events.some((e) => e.type === "inventory")).toBe(false);
  });

  it("lies only once recipes are learned: before, the same tile holds the find it always did", () => {
    expect(page.find).not.toBeNull();
    expect(page.find).not.toBe("recipe_page");
    const w = world();
    w.town({ type: "new_day", day: page.day });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.town({ type: "open_shop" });
    w.town({ type: "open_finds" });
    expect(pickupLeft(w.state, page.x, page.y)).toBe(page.find);
    w.town({ type: "open_recipes" });
    expect(pickupLeft(w.state, page.x, page.y)).toBe("recipe_page");
  });

  it("only ever stand where a find would, so pages never move a branch, a stone, or a find", () => {
    for (let day = page.day; day < page.day + 30; day++) {
      for (let y = 0; y < CONFIG.height; y++) {
        for (let x = 0; x < CONFIG.width; x++) {
          const before = gatherableAt(CONFIG, x, y, day, true, false);
          const after = gatherableAt(CONFIG, x, y, day, true, true);
          if (after === "recipe_page") {
            expect(before && before !== "wood" && before !== "stone", `${x},${y}`).toBeTruthy();
          } else {
            expect(after, `${x},${y} on ${day}`).toBe(before);
          }
        }
      }
    }
  });
});
