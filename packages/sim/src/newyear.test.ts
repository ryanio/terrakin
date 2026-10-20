import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { holidaysOf } from "./holiday";
import { FIREWORKS, fireworkNight } from "./newyear";
import { dayOfDate } from "./season";
import { SHOP_CATALOG } from "./shop";
import { expectSupplyHolds, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld, spawnTile } from "./world";

/**
 * New Year's (RFC 0034): December 26 to January 1, fireworks sold while it runs and set off on its
 * last two nights over your own ground or the Commons, near you, up to a night's limit.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const EVE = dayOfDate(2026, 12, 31);

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

/** A town on `day` with the shop open, Ada home on plot (0, 0), and Cy in the Commons. */
function town(day = EVE): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  ok(state, "ada", { type: "join", name: "ada", kind: "human" });
  ok(state, "ada", { type: "settle", px: 0, py: 0 });
  ok(state, "ada", { type: "build_starter_home" });
  ok(state, "cy", { type: "join", name: "cy", kind: "human" });
  return state;
}

const fire = (x: number, y: number, color = "gold") =>
  ({ type: "set_off_firework", x, y, color }) as Command;
const where = (state: WorldState, id: string) => {
  const r = state.residents[id];
  if (!r) throw new Error(`no ${id}`);
  return r;
};

describe("New Year's", () => {
  it("runs from December 26 to January 1, and its nights are the last two", () => {
    expect(holidaysOf(dayOfDate(2026, 12, 25))).not.toContain("new_year");
    expect(holidaysOf(dayOfDate(2026, 12, 26))).toContain("new_year");
    expect(holidaysOf(dayOfDate(2027, 1, 1))).toEqual(["new_year"]);
    expect(holidaysOf(dayOfDate(2027, 1, 2))).toEqual([]);
    const nights = [30, 31].map((d) => fireworkNight(dayOfDate(2026, 12, d)));
    expect([...nights, fireworkNight(dayOfDate(2027, 1, 1))]).toEqual([false, true, true]);
    expect(fireworkNight(dayOfDate(2027, 1, 2))).toBe(false);
  });

  it("sells fireworks while it runs, and not the day before or after", () => {
    expect(SHOP_CATALOG.firework).toEqual({ price: 2, section: "pantry" });
    ok(town(dayOfDate(2026, 12, 26)), "ada", { type: "shop_buy", sku: "firework", count: 3 });
    for (const day of [dayOfDate(2026, 12, 25), dayOfDate(2027, 1, 2)]) {
      refused(town(day), "ada", { type: "shop_buy", sku: "firework" }, "out_of_holiday");
    }
  });
});

describe("setting off a firework", () => {
  it("takes one from your things over your own plot or the Commons, and everyone sees it", () => {
    const state = town();
    stock(state, "ada", { firework: 2 });
    const ada = where(state, "ada");
    expect(ok(state, "ada", fire(ada.x, ada.y - 1, "violet"))).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "firework",
        changes: [{ kind: "firework", amount: -1, count: 1 }],
      },
      { type: "firework", by: "ada", x: ada.x, y: ada.y - 1, color: "violet" },
    ]);
    stock(state, "cy", { firework: 1 });
    const square = spawnTile(state);
    ok(state, "cy", fire(square.x, square.y));
    expect(state.items?.today.fireworks).toEqual({ ada: 1, cy: 1 });
  });

  it("is refused off its nights, in another color, too far, over a neighbor's plot, or with none", () => {
    const off = town(dayOfDate(2026, 12, 30));
    stock(off, "cy", { firework: 1 });
    const square = spawnTile(off);
    refused(off, "cy", fire(square.x, square.y), "out_of_holiday");
    const state = town();
    stock(state, "cy", { firework: 1 });
    const cy = where(state, "cy");
    refused(state, "cy", fire(cy.x, cy.y, "pink"), "bad_color");
    refused(state, "cy", fire(-1, cy.y), "out_of_bounds");
    refused(state, "cy", fire(cy.x + FIREWORKS.reach + 1, cy.y), "out_of_reach");
    // Near the Commons' north edge, the plot north of it is no one's to light up.
    for (const dir of ["n", "n", "n"] as const) ok(state, "cy", { type: "move", dir });
    const north = where(state, "cy");
    expect(north.y - 2).toBeLessThan(CONFIG.plotSize);
    refused(state, "cy", fire(north.x, north.y - 2), "not_your_plot");
    refused(state, "ada", fire(where(state, "ada").x, where(state, "ada").y), "not_enough_items");
  });

  it("goes up 20 times a night, and the count starts over on January 1", () => {
    const state = town();
    stock(state, "cy", { firework: FIREWORKS.perNight + 2 });
    const { x, y } = where(state, "cy");
    for (let i = 0; i < FIREWORKS.perNight; i++) ok(state, "cy", fire(x, y));
    refused(state, "cy", fire(x, y), "firework_limit");
    ok(state, TOWN_ACTOR, { type: "new_day", day: EVE + 1 });
    ok(state, "cy", fire(x, y));
    ok(state, TOWN_ACTOR, { type: "new_day", day: EVE + 2 });
    refused(state, "cy", fire(x, y), "out_of_holiday");
  });
});
