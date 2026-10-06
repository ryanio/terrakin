import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { CATALOG } from "./catalog";
import { HALLOWEEN_CONFIG, HALLOWEEN_HASH, HALLOWEEN_LOG } from "./fixtures/halloween-log";
import { nextTrickOrTreat, TRICK_OR_TREAT, trickOrTreatDay } from "./halloween";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize, RECIPES } from "./items";
import { plotKey } from "./keys";
import { COSTUMES, wearProblem } from "./looks";
import { replay } from "./replay";
import { dayOfDate } from "./season";
import { HOLIDAY_STOCK, SHOP_CATALOG, stockHoliday } from "./shop";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { visitTile } from "./visit";
import { createWorld } from "./world";

/**
 * Halloween (RFC 0022): its stock sold only while it runs, candy from the kitchen any day, and
 * trick-or-treating on October 31 and November 1, with every guard on what moves refusing and
 * leaving the world as it was.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const FIRST = dayOfDate(2026, 10, 24);
const NIGHT = dayOfDate(2026, 10, 31);
const LAST = dayOfDate(2026, 11, 1);

/** Where everyone lives: plot coordinates. The Commons is (1, 1). */
const HOMES = { ada: [0, 0], bob: [2, 0], cy: [0, 2], dee: [2, 2] } as const;
type Who = keyof typeof HOMES;

function send(state: WorldState, actor: string, command: Command) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  if (!result.ok) expect(hashWorld(state)).toBe(before);
  expectSupplyHolds(state);
  return result;
}

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = send(state, actor, command);
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

/** A town on `day`, coins, items, and the shop open, with four neighbors home in starter huts. */
function town(day = NIGHT): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  for (const [id, [px, py]] of Object.entries(HOMES)) {
    ok(state, id, { type: "join", name: id, kind: "human" });
    ok(state, id, { type: "settle", px, py });
    ok(state, id, { type: "build_starter_home" });
    // Home on the hearth: the day's allowance and pantry, if building didn't already pay them.
    send(state, id, { type: "home" });
  }
  return state;
}

/** Jump `actor` to the door of `whose` plot, as the server's visit would. */
function goTo(state: WorldState, actor: string, whose: Who) {
  const [px, py] = HOMES[whose];
  const tile = visitTile(state, actor, px, py);
  if (!tile) throw new Error("nowhere to land");
  ok(state, actor, { type: "visit", px, py, x: tile.x, y: tile.y });
}

const knock = (whose: Who): Command => {
  const [px, py] = HOMES[whose];
  return { type: "trick_or_treat", px, py };
};

const candy = (state: WorldState, id: string) => state.items?.inventories[id]?.stacks.candy ?? 0;

const coins = (state: WorldState, id: string) => state.economy?.coins[id] ?? 0;

describe("the Halloween log", () => {
  it("replays to its pinned hash, with every coin accounted for and the night's knocks gone", () => {
    const state = replay(HALLOWEEN_CONFIG, HALLOWEEN_LOG);
    expect(hashWorld(state)).toBe(HALLOWEEN_HASH);
    expectSupplyHolds(state);
    expect(state.knocks).toBeUndefined();
  });
});

describe("Halloween's numbers", () => {
  it("are the ones decision 0107 records", () => {
    const priced = Object.fromEntries(
      HOLIDAY_STOCK.halloween.map((sku) => [sku, SHOP_CATALOG[sku]]),
    );
    expect(priced).toEqual({
      candy: { price: 2, section: "pantry" },
      bat_bunting: { price: 12, section: "decor" },
      cauldron: { price: 30, section: "decor" },
      candy_bowl: { price: 15, section: "decor" },
      witch_hat: { price: 60, section: "wear" },
      cat_ears: { price: 40, section: "wear" },
      pumpkin_head: { price: 70, section: "wear" },
      ghost_sheet: { price: 50, section: "wear" },
      bat_wings: { price: 70, section: "wear" },
    });
    expect(CATALOG.candy.recipe).toEqual({
      station: "kitchen",
      needs: { pumpkin: 1, sugar: 1 },
      makes: 5,
    });
    expect(TRICK_OR_TREAT).toEqual({
      nights: [
        { month: 10, date: 31 },
        { month: 11, date: 1 },
      ],
      doorsPerDay: 10,
      townPerDoor: 5,
      townPerDay: 250,
    });
  });

  it("leave every good's recipe making one, so only candy can make more than it uses", () => {
    for (const recipe of Object.values(RECIPES)) expect(recipe.makes).toBeUndefined();
  });
});

describe("Halloween's stock", () => {
  it("is sold from October 24 to November 1, and refused the day before and the day after", () => {
    for (const sku of HOLIDAY_STOCK.halloween) {
      expect(stockHoliday(sku)).toBe("halloween");
      for (const day of [FIRST, NIGHT, LAST]) {
        const state = town(day);
        fund(state, "ada", 200);
        const before = coins(state, "ada");
        ok(state, "ada", { type: "shop_buy", sku });
        expect(coins(state, "ada")).toBe(before - SHOP_CATALOG[sku].price);
      }
      for (const day of [FIRST - 1, LAST + 1, dayOfDate(2027, 6, 1)]) {
        const state = town(day);
        fund(state, "ada", 200);
        const message = refused(state, "ada", { type: "shop_buy", sku }, "out_of_holiday");
        expect(message).toContain("only for Halloween, October 24 to November 1");
      }
    }
  });

  it("says when it's back", () => {
    const state = town(LAST + 1);
    fund(state, "ada", 200);
    const message = refused(state, "ada", { type: "shop_buy", sku: "witch_hat" }, "out_of_holiday");
    expect(message).toContain("the witch hat only for Halloween");
    expect(message).toContain("back on October 24");
  });

  it("keeps a costume for good: bought once, worn after Halloween, refused unbought", () => {
    const state = town(NIGHT);
    fund(state, "ada", 500);
    for (const costume of COSTUMES) {
      refused(state, "bob", { type: "profile", wear: [costume] }, "not_owned");
      ok(state, "ada", { type: "shop_buy", sku: costume });
      refused(state, "ada", { type: "shop_buy", sku: costume }, "already_have");
    }
    ok(state, TOWN_ACTOR, { type: "new_day", day: dayOfDate(2026, 12, 5) });
    ok(state, "ada", { type: "profile", wear: ["witch_hat", "ghost_sheet", "bat_wings"] });
    expect(state.residents.ada?.wear).toEqual(["witch_hat", "ghost_sheet", "bat_wings"]);
    ok(state, "ada", { type: "profile", wear: ["pumpkin_head"] });
    ok(state, "ada", { type: "profile", wear: ["cat_ears"] });
  });

  it("has a ghost sheet that covers the bottom half, like a dress", () => {
    expect(wearProblem(["ghost_sheet", "skirt"])).toContain("A ghost sheet covers the bottom half");
    expect(wearProblem(["ghost_sheet", "witch_hat", "bat_wings", "boots"])).toBeNull();
  });
});

describe("candy from the kitchen", () => {
  it("makes five from a pumpkin and a bag of sugar on any day, with no label", () => {
    const state = town(dayOfDate(2027, 3, 10));
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    stock(state, "ada", { pumpkin: 2 });
    const sugar = state.items?.inventories.ada?.stacks.sugar ?? 0;
    const events = ok(state, "ada", { type: "craft", recipe: "candy", x: 4, y: 2 });
    expect(events).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "craft",
        changes: [
          { kind: "pumpkin", amount: -1, count: 1 },
          { kind: "sugar", amount: -1, count: sugar - 1 },
          { kind: "candy", amount: 5, count: 5 },
        ],
      },
    ]);
    expect(state.items?.today.crafted.ada).toBe(1);
    refused(
      state,
      "ada",
      { type: "craft", recipe: "candy", x: 4, y: 2, label: "Spooky" },
      "invalid_label",
    );
  });

  it("refuses to make more than there's room for", () => {
    const state = town();
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    stock(state, "ada", { pumpkin: 1 });
    // Room for two more after the pumpkin and the sugar go: five won't fit.
    const room = ITEMS.inventoryMax - inventorySize(state.items?.inventories.ada) - 1;
    stock(state, "ada", { jar: room });
    refused(state, "ada", { type: "craft", recipe: "candy", x: 4, y: 2 }, "inventory_full");
  });
});

describe("trick-or-treating", () => {
  it("is on October 31 and November 1, and no other day", () => {
    expect(trickOrTreatDay(NIGHT)).toBe(true);
    expect(trickOrTreatDay(LAST)).toBe(true);
    expect(trickOrTreatDay(NIGHT - 1)).toBe(false);
    expect(trickOrTreatDay(LAST + 1)).toBe(false);
    expect(trickOrTreatDay(dayOfDate(2027, 10, 31))).toBe(true);
    expect(trickOrTreatDay(dayOfDate(2027, 11, 1))).toBe(true);
    for (const day of [NIGHT - 1, LAST + 1, dayOfDate(2027, 7, 4)]) {
      const state = town(day);
      goTo(state, "bob", "dee");
      const message = refused(state, "bob", knock("dee"), "out_of_holiday");
      expect(message).toContain("October 31 and November 1 (UTC)");
    }
    // The refusal names the next night: tomorrow's, or next year's first.
    expect(nextTrickOrTreat(NIGHT - 1)).toBe(NIGHT);
    expect(nextTrickOrTreat(LAST)).toBe(LAST);
    expect(nextTrickOrTreat(LAST + 1)).toBe(dayOfDate(2027, 10, 31));
  });

  it("still takes a knock on every day it ever took one, so logged knocks replay as they were made", () => {
    // Until November 1 counted, a knock was accepted only on October 31, so every knock in a log
    // is from an October 31: a November 1 knock was refused, and refusals aren't logged. The
    // Halloween log's pinned hash covers a night of them.
    for (let year = 2026; year <= 2036; year++) {
      expect(trickOrTreatDay(dayOfDate(year, 10, 31)), `${year}`).toBe(true);
    }
  });

  it("counts each night's caps by its own UTC day: November 1 starts over", () => {
    const state = town();
    ok(state, "dee", { type: "leave" });
    goTo(state, "bob", "dee");
    ok(state, "bob", knock("dee"));
    refused(state, "bob", knock("dee"), "already_knocked");
    // Ten doors and the town's candy at Dee's door, used up on October 31.
    state.knocks = {
      by: { bob: Array.from({ length: TRICK_OR_TREAT.doorsPerDay }, (_, i) => `9${i},9`) },
      town: { [plotKey(2, 2)]: TRICK_OR_TREAT.townPerDoor },
    };
    refused(state, "bob", knock("dee"), "knock_limit");
    ok(state, TOWN_ACTOR, { type: "new_day", day: LAST });
    expect(state.knocks).toBeUndefined();
    // On November 1 the same door answers again, from the town's candy for the new night.
    expect(ok(state, "bob", knock("dee"))[0]).toEqual({
      type: "trick_or_treated",
      by: "bob",
      px: 2,
      py: 2,
      from: "town",
    });
    expect(state.knocks).toEqual({ by: { bob: [plotKey(2, 2)] }, town: { [plotKey(2, 2)]: 1 } });
  });

  it("gets a candy from the town when nobody living there is home", () => {
    const state = town();
    ok(state, "dee", { type: "leave" });
    goTo(state, "bob", "dee");
    const events = ok(state, "bob", knock("dee"));
    expect(events).toEqual([
      { type: "trick_or_treated", by: "bob", px: 2, py: 2, from: "town" },
      {
        type: "inventory",
        residentId: "bob",
        reason: "trick_or_treat",
        changes: [{ kind: "candy", amount: 1, count: 1 }],
      },
    ]);
    expect(state.knocks).toEqual({ by: { bob: [plotKey(2, 2)] }, town: { [plotKey(2, 2)]: 1 } });
  });

  it("gets one from whoever is home with candy, which leaves their things", () => {
    const state = town();
    stock(state, "dee", { candy: 3 });
    goTo(state, "bob", "dee");
    const events = ok(state, "bob", knock("dee"));
    expect(events).toEqual([
      { type: "trick_or_treated", by: "bob", px: 2, py: 2, from: "resident", giver: "dee" },
      {
        type: "inventory",
        residentId: "dee",
        reason: "handed_out",
        changes: [{ kind: "candy", amount: -1, count: 2 }],
        with: "bob",
      },
      {
        type: "inventory",
        residentId: "bob",
        reason: "trick_or_treat",
        changes: [{ kind: "candy", amount: 1, count: 1 }],
        with: "dee",
      },
    ]);
    expect(candy(state, "dee")).toBe(2);
    // The town's candy at the door is untouched.
    expect(state.knocks?.town).toEqual({});
  });

  it("asks a co-owner who's home when the owner isn't", () => {
    const state = town();
    ok(state, "dee", { type: "share_plot", with: "cy" });
    ok(state, "dee", { type: "leave" });
    // Cy is over at Dee's, on the plot they share, below the hut.
    const cy = state.residents.cy;
    if (!cy) throw new Error("no Cy");
    Object.assign(cy, { x: 17, y: 22 });
    stock(state, "cy", { candy: 1 });
    goTo(state, "ada", "dee");
    const events = ok(state, "ada", knock("dee"));
    expect(events[0]).toEqual({
      type: "trick_or_treated",
      by: "ada",
      px: 2,
      py: 2,
      from: "resident",
      giver: "cy",
    });
    expect(candy(state, "cy")).toBe(0);
  });

  it("takes an away owner's candy only through a bowl by the door", () => {
    const away = town();
    stock(away, "dee", { candy: 4 });
    ok(away, "dee", { type: "leave" });
    goTo(away, "bob", "dee");
    expect(ok(away, "bob", knock("dee"))[0]).toMatchObject({ from: "town" });
    expect(candy(away, "dee")).toBe(4);

    const bowl = town();
    fund(bowl, "dee", 100);
    ok(bowl, "dee", { type: "shop_buy", sku: "candy_bowl" });
    const hearth = bowl.residents.dee?.hearth ?? { x: 0, y: 0 };
    ok(bowl, "dee", { type: "place", x: hearth.x + 1, y: hearth.y, block: "candy_bowl" });
    stock(bowl, "dee", { candy: 4 });
    ok(bowl, "dee", { type: "leave" });
    goTo(bowl, "bob", "dee");
    expect(ok(bowl, "bob", knock("dee"))[0]).toEqual({
      type: "trick_or_treated",
      by: "bob",
      px: 2,
      py: 2,
      from: "bowl",
      giver: "dee",
    });
    expect(candy(bowl, "dee")).toBe(3);
  });

  it("answers from the door's plot only: someone home but out on another plot isn't home", () => {
    const state = town();
    stock(state, "dee", { candy: 2 });
    goTo(state, "dee", "ada");
    goTo(state, "bob", "dee");
    expect(ok(state, "bob", knock("dee"))[0]).toMatchObject({ from: "town" });
    expect(candy(state, "dee")).toBe(2);
  });

  it("works from right beside the plot, and not from two tiles away", () => {
    const state = town();
    const bob = state.residents.bob;
    if (!bob) throw new Error("no Bob");
    // Ada's plot is x 0 to 7. The tile east of it is beside it; the next is not.
    Object.assign(bob, { x: 9, y: 3 });
    const message = refused(state, "bob", knock("ada"), "out_of_reach");
    expect(message).toContain('{"type": "visit", "px": 0, "py": 0}');
    Object.assign(bob, { x: 8, y: 3 });
    ok(state, "bob", knock("ada"));
  });

  it("is once a door a night, and a night's doors start over the next day", () => {
    const state = town();
    goTo(state, "bob", "dee");
    ok(state, "bob", knock("dee"));
    refused(state, "bob", knock("dee"), "already_knocked");
    ok(state, TOWN_ACTOR, { type: "new_day", day: NIGHT + 1 });
    expect(state.knocks).toBeUndefined();
  });

  it("stops at ten doors a night", () => {
    const state = town();
    goTo(state, "bob", "dee");
    // Ten doors knocked already tonight (the town only has a few, so they're named here).
    state.knocks = {
      by: { bob: Array.from({ length: TRICK_OR_TREAT.doorsPerDay }, (_, i) => `9${i},9`) },
      town: {},
    };
    refused(state, "bob", knock("dee"), "knock_limit");
  });

  it("refuses when nobody there has candy and the town's is gone, at the door or for the night", () => {
    const door = town();
    ok(door, "dee", { type: "leave" });
    goTo(door, "bob", "dee");
    door.knocks = { by: {}, town: { [plotKey(2, 2)]: TRICK_OR_TREAT.townPerDoor } };
    refused(door, "bob", knock("dee"), "no_candy");
    // A neighbor home with candy still answers the door.
    const home = town();
    goTo(home, "bob", "dee");
    home.knocks = { by: {}, town: { [plotKey(2, 2)]: TRICK_OR_TREAT.townPerDoor } };
    stock(home, "dee", { candy: 1 });
    expect(ok(home, "bob", knock("dee"))[0]).toMatchObject({ from: "resident" });

    const night = town();
    ok(night, "dee", { type: "leave" });
    goTo(night, "bob", "dee");
    night.knocks = {
      by: {},
      town: Object.fromEntries(
        Array.from({ length: TRICK_OR_TREAT.townPerDay / TRICK_OR_TREAT.townPerDoor }, (_, i) => [
          `9${i},9`,
          TRICK_OR_TREAT.townPerDoor,
        ]),
      ),
    };
    refused(night, "bob", knock("dee"), "no_candy");
  });

  it("refuses your own door, a shared one, and your household's", () => {
    const state = town();
    refused(state, "ada", knock("ada"), "own_plot");
    ok(state, "dee", { type: "share_plot", with: "ada" });
    goTo(state, "bob", "cy");
    refused(state, "ada", knock("dee"), "own_plot");
    // Ada and Bob are a person and their AI.
    ok(state, TOWN_ACTOR, { type: "add_owner_pair", pair: ["ada", "bob"] });
    goTo(state, "bob", "ada");
    refused(state, "bob", knock("ada"), "own_plot");
  });

  it("refuses where there's no door: off the world, the Commons, or a plot nobody lives on", () => {
    const state = town();
    refused(state, "bob", { type: "trick_or_treat", px: 9, py: 9 }, "out_of_bounds");
    refused(state, "bob", { type: "trick_or_treat", px: 1, py: 1 }, "plot_is_commons");
    refused(state, "bob", { type: "trick_or_treat", px: 1, py: 0 }, "plot_unclaimed");
  });

  it("is for residents with a hearth, never townsfolk, and needs room for the candy", () => {
    const state = town();
    ok(state, TOWN_ACTOR, { type: "set_townsfolk", ids: ["cy"] });
    goTo(state, "cy", "dee");
    refused(state, "cy", knock("dee"), "not_eligible");

    ok(state, "eve", { type: "join", name: "Eve", kind: "human" });
    const eve = state.residents.eve;
    if (!eve) throw new Error("no Eve");
    Object.assign(eve, { x: 16, y: 15 });
    refused(state, "eve", knock("dee"), "no_hearth");

    goTo(state, "bob", "dee");
    stock(state, "bob", { jar: ITEMS.inventoryMax - inventorySize(state.items?.inventories.bob) });
    refused(state, "bob", knock("dee"), "inventory_full");
  });

  it("needs growing, making, and gathering open", () => {
    const state = createWorld(CONFIG);
    ok(state, TOWN_ACTOR, { type: "new_day", day: NIGHT });
    ok(state, "ada", { type: "join", name: "Ada", kind: "human" });
    refused(state, "ada", { type: "trick_or_treat", px: 2, py: 2 }, "items_closed");
  });
});
