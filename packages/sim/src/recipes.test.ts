import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { RECIPE_NAMES, type RecipeName } from "./catalog";
import { RECIPES_CONFIG, RECIPES_HASH, RECIPES_LOG } from "./fixtures/recipes-log";
import { SHOP_CONFIG, SHOP_LOG } from "./fixtures/shop-log";
import { hashWorld } from "./hash";
import {
  BASE_RECIPES,
  CARD_RECIPES,
  CARD_SKUS,
  cardSeason,
  HOLIDAY_RECIPES,
  knownRecipes,
  knows,
  onShelf,
  picksLeft,
  RECIPES_RULES,
  recipeCardPrice,
  shelfOn,
} from "./recipes";
import { replay } from "./replay";
import { dayOfDate, seasonOf, seasonSpan } from "./season";
import { BUY_ORDERS, buySeason, type SellKind, townBuys, treasuryShareOf } from "./shop";
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
    expect([...HOLIDAY_RECIPES].sort()).toEqual(["candy", "candy_cane", "jack_o_lantern"]);
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
      ].sort(),
    );
    expect(CARD_SKUS).toContain("recipe:well");
    for (const recipe of RECIPE_NAMES) {
      const everyone = (BASE_RECIPES as readonly string[]).includes(recipe);
      const holiday = HOLIDAY_RECIPES.includes(recipe);
      expect(CARD_RECIPES.includes(recipe), recipe).toBe(!everyone && !holiday);
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

describe("knows", () => {
  it("says yes to everyone, for everything, before open_recipes", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.settle("ada", 0);
    for (const recipe of RECIPE_NAMES) expect(knows(w.state, "ada", recipe)).toBe(true);
    expect(knownRecipes(w.state, "ada")).toEqual([...RECIPE_NAMES].sort());
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
    expect(knownRecipes(w.state, "ada")).toEqual([...RECIPE_NAMES].sort());
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
    expect(knownRecipes(w.state, "clem")).toEqual([...RECIPE_NAMES].sort());
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
