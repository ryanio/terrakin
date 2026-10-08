import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { GOOD_KINDS } from "./catalog";
import { MERGE_CONFIG, MERGE_HASH, MERGE_LOG } from "./fixtures/merge-log";
import { hashWorld } from "./hash";
import { ITEMS } from "./items";
import { tileKey } from "./keys";
import { CARD_RECIPES } from "./recipes";
import { replay } from "./replay";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, type GamesState, type Resident, TOWN_ACTOR, type WorldState } from "./types";

/**
 * Merging a duplicate record into the one that stays (issue #46, decision 0239). This takes a
 * resident out of a live world and moves their coins, so every guard has a test that the merge is
 * refused with the world left exactly as it was, and the coins are counted on both sides.
 */

const MERGE = MERGE_LOG.findIndex((i) => i.command.type === "merge_resident");
const FROM = "r_blaze4";
const INTO = "r_blaze";

/** The fixture's world just before the town merges the second Blaze into the first. */
const before = (): WorldState => replay(MERGE_CONFIG, MERGE_LOG.slice(0, MERGE));

const merge = (state: WorldState, from = FROM, into = INTO, actor = TOWN_ACTOR) =>
  apply(state, { actor, command: { type: "merge_resident", from, into } });

const act = (state: WorldState, actor: string, command: Command) => {
  const done = apply(state, { actor, command });
  expect(done, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
};

function dup(state: WorldState): Resident {
  const r = state.residents[FROM];
  if (!r) throw new Error(`no ${FROM}`);
  return r;
}

/** Refused with `code`, and the world exactly as it was. */
function refused(state: WorldState, code: string, from = FROM, into = INTO) {
  const hash = hashWorld(state);
  const result = merge(state, from, into);
  expect(result.ok ? "accepted" : result.rejection.code, `${from} into ${into}`).toBe(code);
  expect(hashWorld(state)).toBe(hash);
}

const coinsOf = (state: WorldState, id: string) => state.economy?.coins[id] ?? 0;
const purses = (state: WorldState) =>
  Object.values(state.economy?.coins ?? {}).reduce((sum, n) => sum + n, 0);

describe("the merge fixture", () => {
  it("replays to its pinned hash, with the duplicate gone and its things kept", () => {
    const state = replay(MERGE_CONFIG, MERGE_LOG);
    expect(hashWorld(state)).toBe(MERGE_HASH);
    expectSupplyHolds(state);
    expect(state.residents[FROM]).toBeUndefined();
    expect(state.mergedResidents).toEqual({ [FROM]: INTO });
    expect(state.plots["2,1"]).toBeUndefined();
    // The welcome gift, Ada's 5, and the grant's 10, less the umbrella's 60.
    expect(coinsOf(state, INTO)).toBe(5);
    expect(state.items?.inventories[INTO]?.stacks).toEqual({ lemon: 3 });
    expect(state.residents[INTO]?.wear).toEqual(["umbrella"]);
    expect(state.economy?.welcomed).toContain(INTO);
    expect(state.economy?.welcomed).not.toContain(FROM);
  });
});

describe("merge_resident", () => {
  it("moves every coin to the record that stays, and mints and burns none", () => {
    const state = before();
    fund(state, INTO, 7);
    const from = coinsOf(state, FROM);
    const into = coinsOf(state, INTO);
    const econ = state.economy;
    if (!econ) throw new Error("no economy");
    const { treasury, minted, burned } = econ;
    const total = purses(state);
    expect(from).toBeGreaterThan(0);
    const result = merge(state);
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "plot_released", px: 2, py: 1, ownerId: FROM },
        { type: "coins", residentId: INTO, amount: from, balance: from + into, reason: "merged" },
        {
          type: "inventory",
          residentId: INTO,
          reason: "merged",
          changes: [{ kind: "lemon", amount: 3, count: 3 }],
        },
        { type: "wear_bought", residentId: INTO, wear: "umbrella" },
        { type: "resident_merged", from: FROM, into: INTO },
      ],
    });
    expect(coinsOf(state, INTO)).toBe(from + into);
    expect(econ.coins).not.toHaveProperty(FROM);
    expect(econ.ledgers).not.toHaveProperty(FROM);
    expect(purses(state)).toBe(total);
    expect([econ.treasury, econ.minted, econ.burned]).toEqual([treasury, minted, burned]);
    expectSupplyHolds(state);
  });

  it("carries made things, wear, and recipes to the kept record, with an event for each", () => {
    const state = before();
    const items = state.items;
    const recipes = state.recipes;
    const card = CARD_RECIPES[0];
    const kind = GOOD_KINDS[0];
    if (!items || !recipes || !card || !kind) throw new Error("fixture");
    stock(state, INTO, { lemon: 2 });
    const good = { id: "i_900", kind, maker: FROM, madeDay: 0 };
    items.inventories[FROM]?.goods.push(good);
    // The kept record joined after recipes opened, in this case, and the duplicate bought a card.
    recipes.everything = recipes.everything.filter((id) => id !== INTO);
    recipes.learned[FROM] = [card];
    const result = merge(state);
    if (!result.ok) throw new Error(result.rejection.message);
    expect(result.events).toContainEqual({
      type: "inventory",
      residentId: INTO,
      reason: "merged",
      changes: [{ kind: "lemon", amount: 3, count: 5 }],
      gained: [good],
    });
    expect(result.events).toContainEqual({
      type: "recipe_learned",
      residentId: INTO,
      recipe: card,
      how: "merged",
    });
    expect(items.inventories[INTO]?.goods).toEqual([good]);
    expect(state.shop?.wardrobe[INTO]).toEqual(["umbrella"]);
    expect(recipes.learned[INTO]).toEqual([card]);
    expect(recipes.learned).not.toHaveProperty(FROM);
  });

  it("never pays the merged resident a second welcome gift", () => {
    const state = before();
    const econ = state.economy;
    if (!econ) throw new Error("no economy");
    // The kept record waits in line for a gift the duplicate already had.
    econ.owed = [INTO];
    expect(econ.welcomed).toContain(FROM);
    expect(merge(state).ok).toBe(true);
    expect(econ.owed).toEqual([]);
    expect(econ.welcomed).toContain(INTO);
  });

  it("drops the gifts that could still go back to or from the duplicate", () => {
    const state = before();
    const items = state.items;
    if (!items) throw new Error("no items");
    const gift = { kind: "lemon" as const, count: 1, day: state.day ?? 0 };
    items.gifts = {
      gift_1: { id: "gift_1", from: FROM, to: "ada", ...gift },
      gift_2: { id: "gift_2", from: "ada", to: FROM, ...gift },
      gift_3: { id: "gift_3", from: "ada", to: "bob", ...gift },
    };
    expect(merge(state).ok).toBe(true);
    expect(Object.keys(items.gifts)).toEqual(["gift_3"]);
  });

  it("comes only from the town", () => {
    const state = before();
    const hash = hashWorld(state);
    expect(merge(state, FROM, INTO, "ada")).toMatchObject({
      ok: false,
      rejection: { code: "server_only" },
    });
    expect(hashWorld(state)).toBe(hash);
  });

  it("refuses an unknown record, a record into itself, and a person into an AI", () => {
    const state = before();
    refused(state, "unknown_resident", "r_nobody");
    refused(state, "unknown_resident", FROM, "r_nobody");
    refused(state, "not_eligible", FROM, FROM);
    // annals is a person; the second Blaze is an AI.
    refused(state, "not_eligible", FROM, "r_annals");
    refused(state, "not_eligible", "r_annals", INTO);
  });

  it("refuses townsfolk on either side", () => {
    const state = before();
    act(state, TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    // Clem is an AI too, so only being townsfolk stands in the way.
    refused(state, "not_eligible", FROM, "clem");
    act(state, TOWN_ACTOR, { type: "set_townsfolk", ids: [FROM] });
    refused(state, "not_eligible");
  });

  it("refuses a duplicate that's in the world", () => {
    const state = before();
    act(state, FROM, { type: "join", name: "Blaze", kind: "agent" });
    refused(state, "not_eligible");
  });

  it("refuses when the kept record hasn't room for the duplicate's things", () => {
    const state = before();
    stock(state, INTO, { stone: ITEMS.inventoryMax - 2 });
    refused(state, "inventory_full");
  });

  // Each case ties the duplicate to something it shares with others, set up directly where no
  // short run of inputs makes it.
  const tied: [string, string, (state: WorldState) => void][] = [
    ["has a pet", "not_eligible", (s) => (dup(s).pet = { kind: "cat", coat: "ginger", name: "B" })],
    [
      "is a maintainer",
      "not_eligible",
      (s) => act(s, TOWN_ACTOR, { type: "set_maintainers", ids: [FROM] }),
    ],
    [
      "is in an owner link",
      "not_eligible",
      (s) => act(s, TOWN_ACTOR, { type: "add_owner_pair", pair: ["eve", FROM] }),
    ],
    ["shares Ada's plot", "not_eligible", (s) => s.plots["0,0"]?.coOwners?.push(FROM)],
    [
      "shares its own plot",
      "not_eligible",
      (s) => {
        const plot = s.plots["2,1"];
        if (plot) plot.coOwners = ["r_pip"];
      },
    ],
    ["has a block on its plot", "plot_has_blocks", (s) => (s.blocks[tileKey(17, 9)] = "wood")],
    ["has a path on its plot", "plot_has_blocks", (s) => (s.ground = { [tileKey(17, 9)]: "dirt" })],
    [
      "has a lot in the market",
      "not_eligible",
      (s) => {
        s.market = {
          nextId: 2,
          listings: { l_1: { id: "l_1", seller: FROM, kind: "lemon", count: 1, price: 5, day: 0 } },
        };
      },
    ],
    [
      "has a bounty running",
      "not_eligible",
      (s) => {
        s.bounties = {
          nextId: 2,
          list: [
            {
              id: "b_1",
              poster: FROM,
              title: "t",
              text: "",
              reward: 1,
              status: "open",
              postedDay: 0,
              expiresDay: 9,
            },
          ],
        };
      },
    ],
    [
      "is hosting an event",
      "not_eligible",
      (s) => {
        s.events = {
          nextId: 2,
          list: [
            {
              id: "e_1",
              host: FROM,
              kind: "show",
              title: "t",
              text: "",
              px: 1,
              py: 1,
              day: 0,
              startsAt: 0,
              minutes: 60,
              status: "scheduled",
              scheduledDay: 0,
              ticks: 0,
            },
          ],
        };
      },
    ],
    [
      "has a seat at a game table",
      "not_eligible",
      (s) => {
        s.games = {
          nextId: 2,
          tables: { g_1: { id: "g_1", seats: [{ resident: FROM, kind: "agent", missed: 0 }] } },
          finished: [],
          today: { rated: {}, pairs: {} },
        } as unknown as GamesState;
      },
    ],
    [
      "wrote an open proposal",
      "not_eligible",
      (s) => {
        s.town = {
          nextId: 2,
          built: {},
          proposals: [
            {
              id: "t_1",
              author: FROM,
              kind: "advisory",
              title: "t",
              text: "",
              status: "open",
              filedDay: 0,
              votes: {},
            },
          ],
        };
      },
    ],
    [
      "has claimed a bounty",
      "not_eligible",
      (s) => {
        s.bounties = {
          nextId: 2,
          list: [
            {
              id: "b_1",
              poster: "ada",
              claimant: FROM,
              title: "t",
              text: "",
              reward: 1,
              status: "claimed",
              postedDay: 0,
              expiresDay: 9,
            },
          ],
        };
      },
    ],
    [
      "would be paid by a queued grant",
      "not_eligible",
      (s) => {
        s.town = {
          nextId: 2,
          built: {},
          proposals: [
            {
              id: "t_1",
              author: "ada",
              kind: "grant",
              title: "t",
              text: "",
              amount: 5,
              to: FROM,
              status: "queued",
              filedDay: 0,
              votes: {},
            },
          ],
        };
      },
    ],
    [
      "has something held aside",
      "not_eligible",
      (s) => {
        if (s.items) s.items.heldAside = [{ find: "acorn", by: FROM, day: 0 } as never];
      },
    ],
    [
      "has something on display",
      "not_eligible",
      (s) => {
        if (s.items) s.items.displays = { "1,1": { find: "acorn", by: FROM, day: 0 } as never };
      },
    ],
  ];
  for (const [how, code, tie] of tied) {
    it(`refuses a duplicate that ${how}`, () => {
      const state = before();
      tie(state);
      refused(state, code);
    });
  }

  it("leaves the merged record out of the world for good", () => {
    const state = before();
    expect(merge(state).ok).toBe(true);
    const back = { type: "join", name: "Blaze", kind: "agent" } as const;
    expect(apply(state, { actor: FROM, command: back })).toMatchObject({
      ok: false,
      rejection: { code: "not_eligible" },
    });
    expect(apply(state, { actor: FROM, command: { type: "move", dir: "e" } })).toMatchObject({
      ok: false,
      rejection: { code: "not_joined" },
    });
    // The record merged into, merged on in turn, points at the one that stays now.
    act(state, "r_pip", { type: "join", name: "Pip", kind: "agent" });
    act(state, "r_pip", { type: "leave" });
    expect(merge(state, INTO, "r_pip").ok).toBe(true);
    expect(state.mergedResidents).toEqual({ [FROM]: "r_pip", [INTO]: "r_pip" });
    expectSupplyHolds(state);
  });
});
