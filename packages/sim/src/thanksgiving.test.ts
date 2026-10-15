import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { joinTile } from "./events";
import { hashWorld } from "./hash";
import { holidaysOf, inHoliday } from "./holiday";
import { dayOfDate } from "./season";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { feastDay, isDish } from "./thanksgiving";
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
 * Thanksgiving (RFC 0034): the fourth Thursday of November with its days either side, its decor
 * sold only then, and the feast, where each resident in its area brings one dish to the table.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY_MS = 86_400_000;
const FEAST = dayOfDate(2026, 11, 26);

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

/** A town on `day` with items and the shop open, Ada and Bob joined, and the feast scheduled. */
function town(day = FEAST): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
    { type: "set_townsfolk", ids: ["clem"] },
    {
      type: "schedule_town_event",
      key: "thanksgiving-feast-2026",
      kind: "gathering",
      title: "Thanksgiving feast",
      startsAt: day * DAY_MS + 18 * 3_600_000,
      minutes: 540,
    },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  for (const id of ["ada", "bob", "clem"]) ok(state, id, { type: "join", name: id, kind: "human" });
  return state;
}

/** Start the feast. Residents join in the Commons, so they're at it already. */
function feastOn(state: WorldState) {
  ok(state, TOWN_ACTOR, { type: "event_start", event: "e_1" });
}

/** A pumpkin pie Ada made, put straight into her things. */
function pie(state: WorldState, id = "i_90") {
  stock(state, "ada", {});
  state.items?.inventories.ada?.goods.push({
    id,
    kind: "pumpkin_pie",
    maker: "ada",
    madeDay: FEAST,
  });
  return id;
}

describe("Thanksgiving's days", () => {
  it("run from the Monday before the fourth Thursday of November to the Sunday after", () => {
    expect(inHoliday("thanksgiving", dayOfDate(2026, 11, 22))).toBe(false);
    expect(holidaysOf(dayOfDate(2026, 11, 23))).toEqual(["thanksgiving"]);
    expect(holidaysOf(dayOfDate(2026, 11, 29))).toEqual(["thanksgiving"]);
    expect(inHoliday("thanksgiving", dayOfDate(2026, 11, 30))).toBe(false);
    expect(feastDay(dayOfDate(2026, 10, 15))).toBe(FEAST);
    expect(feastDay(dayOfDate(2027, 1, 5))).toBe(dayOfDate(2027, 11, 25));
  });

  it("sell their decor only while they run", () => {
    const before = town(dayOfDate(2026, 11, 22));
    fund(before, "ada", 50);
    refused(before, "ada", { type: "shop_buy", sku: "cornucopia" }, "out_of_holiday");
    const during = town();
    fund(during, "ada", 50);
    ok(during, "ada", { type: "shop_buy", sku: "cornucopia" });
    expect(during.items?.inventories.ada?.stacks.cornucopia).toBe(1);
  });
});

describe("the feast", () => {
  it("takes one dish from each resident in its area, made or a sweet, and sets it on the table", () => {
    const state = town();
    stock(state, "bob", { candy: 3 });
    const id = pie(state);
    feastOn(state);
    expect(ok(state, "ada", { type: "bring_dish", item: id })).toEqual([
      { type: "inventory", residentId: "ada", reason: "brought", lost: [id] },
      { type: "dish_brought", by: "ada", kind: "pumpkin_pie", event: "e_1" },
    ]);
    expect(state.items?.inventories.ada?.goods).toEqual([]);
    ok(state, "bob", { type: "bring_dish", item: "candy" });
    expect(state.items?.inventories.bob?.stacks.candy).toBe(2);
    expect(state.events?.list[0]?.dishes).toEqual([
      { by: "ada", kind: "pumpkin_pie" },
      { by: "bob", kind: "candy" },
    ]);
    refused(state, "bob", { type: "bring_dish", item: "candy" }, "already_brought");
  });

  it("refuses what isn't from a kitchen, what you don't hold, and townsfolk", () => {
    const state = town();
    stock(state, "ada", { pumpkin: 2, wood: 1, candy: 1 });
    feastOn(state);
    refused(state, "ada", { type: "bring_dish", item: "pumpkin" }, "not_food");
    refused(state, "ada", { type: "bring_dish", item: "wood" }, "not_food");
    // A made dish goes by its id, not its kind.
    refused(state, "ada", { type: "bring_dish", item: "lemonade" }, "not_food");
    refused(state, "ada", { type: "bring_dish", item: "pumpkin_pie" }, "not_food");
    refused(state, "ada", { type: "bring_dish", item: "i_404" }, "not_enough_items");
    refused(state, "ada", { type: "bring_dish", item: "candy_cane" }, "not_enough_items");
    stock(state, "clem", { candy: 1 });
    refused(state, "clem", { type: "bring_dish", item: "candy" }, "not_eligible");
  });

  it("takes a dish only while the feast is on and only from its area", () => {
    const state = town();
    stock(state, "ada", { candy: 2 });
    refused(state, "ada", { type: "bring_dish", item: "candy" }, "out_of_holiday");
    // Ada goes home to her own plot, out of the feast's area.
    ok(state, "ada", { type: "settle", px: 0, py: 0 });
    ok(state, "ada", { type: "build_starter_home" });
    ok(state, TOWN_ACTOR, { type: "event_start", event: "e_1" });
    refused(state, "ada", { type: "bring_dish", item: "candy" }, "not_at_feast");
    const tile = joinTile(state, "ada", state.events?.list[0] as never);
    ok(state, "ada", { type: "join_event", event: "e_1", ...tile });
    ok(state, "ada", { type: "bring_dish", item: "candy" });
  });

  it("is only the town's event on Thanksgiving's Thursday: the Sunday gathering that week takes no dish", () => {
    const state = town(dayOfDate(2026, 11, 29));
    stock(state, "ada", { candy: 1 });
    feastOn(state);
    refused(state, "ada", { type: "bring_dish", item: "candy" }, "out_of_holiday");
  });

  it("is only the town's event during Thanksgiving: a town gathering another day takes no dish", () => {
    const state = town(dayOfDate(2026, 12, 3));
    stock(state, "ada", { candy: 1 });
    feastOn(state);
    refused(state, "ada", { type: "bring_dish", item: "candy" }, "out_of_holiday");
  });

  it("puts on the table only what a kitchen makes", () => {
    expect(isDish("pumpkin_pie")).toBe(true);
    expect(isDish("lemon_jam")).toBe(true);
    expect(isDish("candy")).toBe(true);
    expect(isDish("pumpkin")).toBe(false);
    expect(isDish("bouquet")).toBe(false);
    expect(isDish("cornucopia")).toBe(false);
    expect(isDish("__proto__")).toBe(false);
  });
});
