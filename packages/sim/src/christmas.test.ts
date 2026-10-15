import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { openDayOf, PRESENTS, presentsFor, wrapDay } from "./christmas";
import { hashWorld } from "./hash";
import { ITEMS } from "./items";
import { dayOfDate } from "./season";
import { expectSupplyHolds, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Christmas inside Midwinter (RFC 0034): presents wrapped with `give` from December 1 to 25 and
 * opened from December 25, the ones left wrapped opening themselves in the new year, and the
 * town's present of candy canes on December 25.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = apply(state, { actor, command });
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  expectSupplyHolds(state);
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

/**
 * A town on `day` with coins, items, and the shop open: Ada and Bob home in starter huts, Clem
 * townsfolk, and Cy joined with no home.
 */
function town(day: number): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
    { type: "set_townsfolk", ids: ["clem"] },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  for (const [id, px] of [
    ["ada", 0],
    ["bob", 2],
  ] as const) {
    ok(state, id, { type: "join", name: id, kind: "human" });
    ok(state, id, { type: "settle", px, py: 0 });
    ok(state, id, { type: "build_starter_home" });
  }
  for (const id of ["clem", "cy"]) ok(state, id, { type: "join", name: id, kind: "human" });
  return state;
}

const toDay = (state: WorldState, day: number) => ok(state, TOWN_ACTOR, { type: "new_day", day });
const held = (state: WorldState, id: string, kind: string) =>
  (state.items?.inventories[id]?.stacks as Record<string, number> | undefined)?.[kind] ?? 0;
const DEC = (date: number, year = 2026) => dayOfDate(year, 12, date);

describe("wrapping a present", () => {
  it("is open from December 1 to 25", () => {
    expect([30, 1].map((d, i) => wrapDay(i ? DEC(d) : dayOfDate(2026, 11, d)))).toEqual([
      false,
      true,
    ]);
    expect(wrapDay(DEC(25))).toBe(true);
    expect(wrapDay(DEC(26))).toBe(false);
    expect(openDayOf(DEC(1))).toBe(DEC(PRESENTS.openFrom));
  });

  it("takes the thing out of the giver's things and holds it, unseen, for its recipient", () => {
    const state = town(DEC(1));
    stock(state, "ada", { herb: 3 });
    const bobHerbs = held(state, "bob", "herb");
    const give = { type: "give", item: "herb", to: "bob", count: 2, wrapped: true } as Command;
    const events = ok(state, "ada", give);
    expect(events).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "gift_out",
        changes: [{ kind: "herb", amount: -2, count: 1 }],
        with: "bob",
      },
      { type: "present_given", from: "ada", to: "bob", present: "present_1" },
    ]);
    expect(held(state, "bob", "herb")).toBe(bobHerbs);
    expect(presentsFor(state, "bob")).toEqual([
      { id: "present_1", from: "ada", to: "bob", kind: "herb", count: 2, day: DEC(1) },
    ]);
    // It counts toward the day's giving like any gift.
    expect(state.items?.today.given.ada).toBe(2);
  });

  it("carries no note", () => {
    const state = town(DEC(1));
    stock(state, "ada", { herb: 1 });
    const give = { type: "give", item: "herb", to: "bob", note: "hi", wrapped: true } as Command;
    refused(state, "ada", give, "invalid_gift");
  });

  it("is refused outside December 1 to 25, leaving the world as it was", () => {
    for (const day of [dayOfDate(2026, 11, 30), DEC(26), dayOfDate(2027, 7, 4)]) {
      const state = town(day);
      stock(state, "ada", { herb: 1 });
      const give = { type: "give", item: "herb", to: "bob", wrapped: true } as Command;
      refused(state, "ada", give, "out_of_holiday");
    }
  });
});

describe("opening a present", () => {
  /** Bob holds Ada's present of 2 herbs and a jar of herb tea she made, wrapped on December 10. */
  function wrapped() {
    const state = town(DEC(10));
    stock(state, "ada", { herb: 4, jar: 1 });
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    ok(state, "ada", { type: "craft", recipe: "herb_tea", x: 4, y: 2 });
    const tea = state.items?.inventories.ada?.goods[0];
    if (!tea) throw new Error("no tea");
    ok(state, "ada", { type: "give", item: "herb", to: "bob", count: 2, wrapped: true });
    ok(state, "ada", { type: "give", item: tea.id, to: "bob", wrapped: true });
    return { state, tea };
  }

  it("waits for December 25, then brings what's inside, with who it's from", () => {
    const { state, tea } = wrapped();
    toDay(state, DEC(24));
    refused(state, "bob", { type: "open_present", present: "present_1" }, "not_yet");
    toDay(state, DEC(25));
    // Coming home first, so the day's allowance and pantry don't ride on the opening.
    ok(state, "bob", { type: "home" });
    const herbs = held(state, "bob", "herb");
    expect(ok(state, "bob", { type: "open_present", present: "present_1" })).toEqual([
      {
        type: "inventory",
        residentId: "bob",
        reason: "present",
        changes: [{ kind: "herb", amount: 2, count: herbs + 2 }],
        with: "ada",
      },
      { type: "present_opened", by: "bob", from: "ada", present: "present_1" },
    ]);
    const events = ok(state, "bob", { type: "open_present", present: "present_2" });
    expect(events[0]).toMatchObject({ reason: "present", gained: [tea], with: "ada" });
    // The tea keeps its maker wherever it goes.
    expect(state.items?.inventories.bob?.goods).toEqual([tea]);
    expect(presentsFor(state, "bob")).toEqual([]);
    expect(state.items?.presents).toBeUndefined();
  });

  it("is refused for a present that isn't yours, and one that won't fit", () => {
    const { state } = wrapped();
    toDay(state, DEC(25));
    for (const present of ["present_1", "present_9", "__proto__"]) {
      refused(state, "ada", { type: "open_present", present }, "unknown_present");
    }
    const room = ITEMS.inventoryMax - 1;
    const herbs = held(state, "bob", "herb");
    stock(state, "bob", { stone: room - herbs - held(state, "bob", "stone") });
    refused(state, "bob", { type: "open_present", present: "present_1" }, "inventory_full");
  });

  it("opens itself at the first new day of the new year when it fits, and waits when it doesn't", () => {
    const { state } = wrapped();
    stock(state, "ada", { herb: 1 });
    ok(state, "ada", { type: "give", item: "herb", to: "cy", wrapped: true });
    // Cy's things are full, so his present waits to be opened by hand.
    stock(state, "cy", { stone: ITEMS.inventoryMax });
    toDay(state, dayOfDate(2027, 1, 1));
    expect(presentsFor(state, "bob")).toEqual([]);
    expect(presentsFor(state, "cy").map((p) => p.id)).toEqual(["present_3"]);
    stock(state, "cy", { stone: -1 });
    ok(state, "cy", { type: "open_present", present: "present_3" });
  });
});

describe("a present still wrapped", () => {
  const ART = "m_0123456789abcdef";

  it("loses its picture when staff take a piece's picture down, and opens without it", () => {
    const state = town(DEC(5));
    ok(state, "ada", { type: "make_piece", media: ART, title: "Snow" });
    ok(state, "ada", { type: "give", item: "i_1", to: "bob", wrapped: true });
    expect(ok(state, TOWN_ACTOR, { type: "remove_display", item: "i_1", picture: true })).toEqual([
      { type: "picture_removed", items: ["i_1"] },
    ]);
    toDay(state, DEC(25));
    ok(state, "bob", { type: "open_present", present: "present_1" });
    const piece = state.items?.inventories.bob?.goods.find((g) => g.id === "i_1");
    expect(piece).toMatchObject({ kind: "piece", maker: "ada" });
    expect(piece?.media).toBeUndefined();
  });

  it("keeps either of its residents from being merged away until it's opened", () => {
    const merge = { type: "merge_resident", from: "dot", into: "cy" } as Command;
    // Dot gave a present: refused until Bob opens it.
    const given = town(DEC(5));
    ok(given, "dot", { type: "join", name: "dot", kind: "human" });
    stock(given, "dot", { herb: 2 });
    ok(given, "dot", { type: "give", item: "herb", to: "bob", wrapped: true });
    ok(given, "dot", { type: "leave" });
    refused(given, TOWN_ACTOR, merge, "not_eligible");
    toDay(given, DEC(25));
    ok(given, "bob", { type: "open_present", present: "present_1" });
    ok(given, TOWN_ACTOR, merge);
    // A present waits for Dot: refused too.
    const waiting = town(DEC(5));
    ok(waiting, "dot", { type: "join", name: "dot", kind: "human" });
    ok(waiting, "dot", { type: "leave" });
    stock(waiting, "ada", { herb: 1 });
    ok(waiting, "ada", { type: "give", item: "herb", to: "dot", wrapped: true });
    refused(waiting, TOWN_ACTOR, merge, "not_eligible");
  });

  it("opens at the new year oldest first, each while it fits", () => {
    const state = town(DEC(5));
    stock(state, "ada", { herb: 3, stone: 5 });
    for (const [item, count] of [
      ["herb", 1],
      ["stone", 5],
      ["herb", 2],
    ] as const) {
      ok(state, "ada", { type: "give", item, to: "cy", count, wrapped: true });
    }
    // Room for 3: the first fits, the 5 stones don't, and the 2 herbs after them do.
    stock(state, "cy", { wood: ITEMS.inventoryMax - 3 });
    toDay(state, dayOfDate(2027, 1, 1));
    expect(held(state, "cy", "herb")).toBe(3);
    expect(presentsFor(state, "cy").map((p) => p.id)).toEqual(["present_2"]);
  });
});

describe("the town's present", () => {
  const leave = (to: string[]) => ({ type: "town_presents", to }) as Command;

  it("leaves 3 candy canes for each resident listed, on December 25, once a year", () => {
    const state = town(DEC(25));
    expect(ok(state, TOWN_ACTOR, leave(["ada", "bob"]))).toEqual([
      { type: "present_given", from: TOWN_ACTOR, to: "ada", present: "present_1" },
      { type: "present_given", from: TOWN_ACTOR, to: "bob", present: "present_2" },
    ]);
    expect(presentsFor(state, "ada")).toEqual([
      {
        id: "present_1",
        from: TOWN_ACTOR,
        to: "ada",
        kind: "candy_cane",
        count: PRESENTS.townCanes,
        day: DEC(25),
      },
    ]);
    ok(state, "ada", { type: "open_present", present: "present_1" });
    refused(state, TOWN_ACTOR, leave(["ada"]), "server_only");
  });

  it("comes only from the town, only on December 25, and only to residents it's for", () => {
    refused(town(DEC(24)), TOWN_ACTOR, leave(["ada"]), "server_only");
    refused(town(DEC(26)), TOWN_ACTOR, leave(["ada"]), "server_only");
    const state = town(DEC(25));
    refused(state, "ada", leave(["ada"]), "server_only");
    // Sorted, each once, with a hearth, not townsfolk, and no present waiting already.
    for (const to of [[], ["bob", "ada"], ["ada", "ada"], ["cy"], ["clem"], ["zed"]]) {
      refused(state, TOWN_ACTOR, leave(to), "server_only");
    }
    stock(state, "bob", { herb: 1 });
    ok(state, "bob", { type: "give", item: "herb", to: "ada", wrapped: true });
    refused(state, TOWN_ACTOR, leave(["ada"]), "server_only");
    ok(state, TOWN_ACTOR, leave(["bob"]));
  });
});
