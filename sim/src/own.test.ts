import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { BOUNTIES_CONFIG, BOUNTIES_LOG } from "./fixtures/bounties-log";
import { hashWorld } from "./hash";
import { isOwnableKey, own, residentById } from "./own";
import { replay } from "./replay";
import { fund, stock } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldState } from "./types";

/**
 * Ids in inputs are looked up as a record's own keys (`own`), so an id that names something every
 * object inherits finds nothing. Inputs are logged, so one that got through would do its damage
 * again on every replay.
 */

const DANGEROUS = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"];

/**
 * The bounties world, with gifts open, a listing, a running bounty, a gift, a vote open, and an
 * event on the calendar.
 */
function world(): WorldState {
  const state = replay(BOUNTIES_CONFIG, BOUNTIES_LOG);
  const ok = (actor: string, command: Command) =>
    expect(apply(state, { actor, command }), `${actor} ${JSON.stringify(command)}`).toMatchObject({
      ok: true,
    });
  ok(TOWN_ACTOR, { type: "open_gifts" });
  for (const id of ["ada", "bob", "cy", "dee"]) {
    fund(state, id, 100);
    stock(state, id, { lemon: 5, sugar: 2 });
  }
  ok("ada", { type: "list_item", item: "lemon", price: 5 });
  ok("dee", { type: "post_bounty", title: "Paint the fence", reward: 5 });
  ok("ada", { type: "give", item: "lemon", to: "bob" });
  ok("cy", { type: "propose", kind: "advisory", title: "More lemons", text: "" });
  const day = state.day ?? 0;
  ok("ada", {
    type: "schedule_event",
    kind: "listening",
    title: "Records",
    px: 0,
    py: 0,
    startsAt: (day + 1) * 86_400_000,
    minutes: 60,
  });
  return state;
}

/** Every input that names something by an id, with `id` in that place. */
function inputs(id: string, day: number): [string, Command][] {
  const ada = (command: Command): [string, Command] => ["ada", command];
  const town = (command: Command): [string, Command] => [TOWN_ACTOR, command];
  return [
    ada({ type: "give_coins", to: id, amount: 1 }),
    ada({ type: "give", item: "lemon", to: id }),
    ada({ type: "give", item: id, to: "bob" }),
    ada({ type: "share_plot", with: id }),
    ada({ type: "unshare_plot", with: id }),
    ["bob", { type: "decline_gift", gift: id }],
    ada({ type: "propose", kind: "grant", title: "For you", text: "", amount: 10, to: id }),
    ada({ type: "vote", proposal: id, choice: "yes" }),
    ada({ type: "withdraw", proposal: id }),
    ada({ type: "list_item", item: id, price: 5 }),
    ada({ type: "unlist_item", listing: id }),
    ["bob", { type: "buy_listing", listing: id }],
    ada({ type: "display", item: id, x: 0, y: 0 }),
    ada({ type: "sell_to_town", item: id } as Command),
    ada({ type: "shop_buy", sku: id } as Command),
    ada({ type: "craft", recipe: id, x: 0, y: 0 } as Command),
    ada({ type: "plant", seed: id, x: 0, y: 0 } as Command),
    ada({ type: "move", dir: id } as Command),
    ada({ type: "profile", wearStyle: { [id]: { color: "sun" } } } as Command),
    ada({ type: "profile", wear: [id] } as Command),
    ada({ type: "place", x: 0, y: 0, block: id } as Command),
    ada({ type: "putter", steps: [id] } as Command),
    ada({ type: "claim_bounty", bounty: id }),
    ada({ type: "drop_bounty", bounty: id }),
    ada({ type: "complete_bounty", bounty: id }),
    ["dee", { type: "confirm_bounty", bounty: id, to: "ada" }],
    ["dee", { type: "cancel_bounty", bounty: id }],
    town({ type: "close_proposal", proposal: id }),
    town({ type: "void_proposal", proposal: id, by: "staff_0123456789ab" }),
    town({ type: "remove_listing", listing: id }),
    town({ type: "remove_display", item: id }),
    town({ type: "remove_display", item: id, picture: true }),
    town({ type: "confirm_town_bounty", bounty: id, to: "ada", by: "staff_0123456789ab" }),
    town({ type: "void_bounty", bounty: id, by: "staff_0123456789ab" }),
    town({ type: "reopen_bounty", bounty: id, by: "staff_0123456789ab" }),
    town({ type: "set_entitlements", residentId: id, items: [] }),
    town({ type: "leave_idle", ids: [id] }),
    town({ type: "leave_idle", ids: ["ada", id] }),
    town({ type: "routine_step", resident: id, routine: "walk_home", step: { type: "home" } }),
    town({ type: "routine_step", resident: "ada", routine: id, step: { type: "home" } } as Command),
    ada({ type: "set_routines", routines: [{ kind: id, hour: 1 }] } as Command),
    ada({ type: "cancel_event", event: id }),
    ada({ type: "join_event", event: id }),
    ada({
      type: "schedule_event",
      kind: id,
      title: "t",
      px: 0,
      py: 0,
      startsAt: 0,
      minutes: 60,
    } as Command),
    town({ type: "event_start", event: id }),
    town({ type: "event_tick", event: id, slot: 1 }),
    town({ type: "event_end", event: id }),
    town({ type: "void_event", event: id, by: "staff_0123456789ab" }),
    town({
      type: "schedule_town_event",
      key: "harvest-night",
      kind: "gathering",
      title: "Harvest night",
      startsAt: (day + 1) * 86_400_000,
      minutes: 60,
      faces: [id],
    }),
    town({
      type: "daily_awards",
      day: day - 1,
      awards: [{ to: id, amount: 1, reason: "appreciation" }],
    }),
  ];
}

describe("ids an object inherits", () => {
  it("find nothing in a record", () => {
    const record: Record<string, number> = { a: 1 };
    expect(own(record, "a")).toBe(1);
    for (const id of DANGEROUS) expect(own(record, id)).toBeUndefined();
    expect(own(record, 7)).toBeUndefined();
    expect(own(undefined, "a")).toBeUndefined();
    expect(isOwnableKey("r_0123456789abcdef")).toBe(true);
    expect(isOwnableKey("__proto__")).toBe(false);
    expect(isOwnableKey("toString")).toBe(false);
  });

  it("are refused by every input that takes an id, and change nothing", () => {
    for (const id of DANGEROUS) {
      const state = world();
      expect(residentById(state, id)).toBeUndefined();
      for (const [actor, command] of inputs(id, state.day ?? 0)) {
        const before = hashWorld(state);
        const result = apply(state, { actor, command });
        expect(result.ok, `${actor} ${JSON.stringify(command)}`).toBe(false);
        expect(hashWorld(state), `${actor} ${JSON.stringify(command)}`).toBe(before);
      }
      // Nothing reached what every object shares.
      expect(Object.keys(Object.prototype)).toEqual([]);
      expect(({} as Record<string, unknown>).takenDown).toBeUndefined();
    }
  });

  it("are refused the same while acting would bring the resident back", () => {
    for (const id of DANGEROUS) {
      const state = world();
      const town = (command: Command) => apply(state, { actor: TOWN_ACTOR, command });
      expect(town({ type: "implicit_presence" }).ok).toBe(true);
      const online = Object.values(state.residents).filter((r) => r.online);
      expect(town({ type: "leave_idle", ids: online.map((r) => r.id).sort() }).ok).toBe(true);
      for (const [actor, command] of inputs(id, state.day ?? 0)) {
        const before = hashWorld(state);
        const result = apply(state, { actor, command });
        expect(result.ok, `${actor} ${JSON.stringify(command)}`).toBe(false);
        expect(hashWorld(state), `${actor} ${JSON.stringify(command)}`).toBe(before);
      }
      expect(Object.values(state.residents).some((r) => r.online)).toBe(false);
      expect(Object.keys(Object.prototype)).toEqual([]);
    }
  });
});
