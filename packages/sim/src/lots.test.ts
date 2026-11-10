import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { LOTS_CONFIG, LOTS_HASH, LOTS_LOG } from "./fixtures/lots-log";
import { hashWorld } from "./hash";
import { inLot, LOTS, lotBounds } from "./lots";
import { replay } from "./replay";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, type Rejection, TOWN_ACTOR, type WorldEvent } from "./types";
import { commonsPlot, createWorld } from "./world";

/**
 * Ada on plot (0, 0) of a regridded world (RFC 0052): her starter hut in the middle of a 16-tile
 * slot, her lot the first 8 by 8, tiles 4 to 11. Every refusal leaves the state as it was.
 */
function world() {
  const state = createWorld({
    width: 48,
    height: 48,
    plotSize: 8,
    maxPlotsPerResident: 1,
    reach: 3,
  });
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refused = (actor: string, command: Command): Rejection => {
    const result = send(actor, command);
    expect(result.ok, `${actor} ${JSON.stringify(command)} should be refused`).toBe(false);
    return result.ok ? { code: "internal" as never, message: "" } : result.rejection;
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  for (const type of [
    "open_economy",
    "open_items",
    "starter_edges",
    "plot_reach",
    "regrid",
  ] as const) {
    ok(TOWN_ACTOR, { type });
  }
  ok("ada", { type: "join", name: "ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  return { state, ok, refused };
}

/** Sets `n` more armchairs down inside the hut, past the hearth. */
function furnish(w: ReturnType<typeof world>, n: number) {
  stock(w.state, "ada", { armchair: n });
  const spots = [6, 7, 8, 9].flatMap((x) => [6, 8, 9].map((y) => ({ x, y })));
  const placed = Object.values(w.state.blocks).filter((b) => b === "armchair").length;
  for (const { x, y } of spots.slice(placed, placed + n)) {
    w.ok("ada", { type: "place", x, y, block: "armchair" });
  }
}

const grow = { type: "grow_lot", px: 0, py: 0 } as const;

describe("lots (RFC 0052)", () => {
  it("replays the lots log to its pinned hash", () => {
    const state = replay(LOTS_CONFIG, LOTS_LOG);
    expect(lotBounds(state, 0, 0)).toEqual({ x0: 3, y0: 3, side: 10 });
    expect(hashWorld(state)).toBe(LOTS_HASH);
  });

  it("keeps its frozen steps", () => {
    expect(LOTS).toEqual({
      first: 8,
      steps: [
        { side: 10, coins: 150, pieces: 6, onShow: 0 },
        { side: 12, coins: 300, pieces: 12, onShow: 4 },
        { side: 14, coins: 600, pieces: 20, onShow: 10 },
        { side: 16, coins: 1000, pieces: 30, onShow: 20 },
      ],
    });
  });

  it("is grown by a co-owner, never on the Commons", () => {
    const w = world();
    w.ok("bo", { type: "join", name: "bo", kind: "human" });
    w.ok("ada", { type: "share_plot", with: "bo" });
    furnish(w, LOTS.steps[0].pieces);
    fund(w.state, "bo", LOTS.steps[0].coins);
    w.ok("bo", grow);
    const c = commonsPlot(w.state);
    expect(w.refused("bo", { type: "grow_lot", px: c.px, py: c.py }).code).toBe("plot_is_commons");
  });

  it("starts at 8 in the middle of the slot, with the hut inside it", () => {
    const w = world();
    expect(lotBounds(w.state, 0, 0)).toEqual({ x0: 4, y0: 4, side: 8 });
    const hearth = w.state.residents.ada?.hearth;
    expect(hearth && inLot(w.state, hearth.x, hearth.y)).toBe(true);
    expect(w.refused("ada", { type: "lay", x: 3, y: 6, ground: "dirt" }).code).toBe("outside_lot");
    expect(w.refused("ada", { type: "place", x: 12, y: 6, block: "planter" }).code).toBe(
      "outside_lot",
    );
  });

  it("names the lot size that reaches a yard tile and how many steps away it is", () => {
    const w = world();
    expect(w.refused("ada", { type: "lay", x: 3, y: 6, ground: "dirt" }).message).toBe(
      "That's in the wild yard, past this plot's lot of 8 by 8. grow_lot at px 0, py 0 grows it to 10 by 10, which reaches it.",
    );
    // The slot's outer ring is reached only by the last step.
    expect(w.refused("ada", { type: "lay", x: 0, y: 6, ground: "dirt" }).message).toBe(
      "That's in the wild yard, past this plot's lot of 8 by 8. A lot of 16 by 16 reaches it, 4 grow_lot steps from now; grow_lot at px 0, py 0 grows it to 10 by 10 first.",
    );
  });

  it("grows a step once the home shows enough and the coins are there, and the lot reaches further", () => {
    const w = world();
    const first = LOTS.steps[0];
    furnish(w, first.pieces - 1);
    fund(w.state, "ada", first.coins);
    expect(w.refused("ada", grow).code).toBe("not_eligible");
    furnish(w, 1);
    const coins = w.state.economy?.coins.ada ?? 0;
    expect(w.ok("ada", grow)).toContainEqual({
      type: "lot_grown",
      px: 0,
      py: 0,
      lot: 10,
      by: "ada",
    });
    expect(w.state.economy?.coins.ada).toBe(coins - first.coins);
    expectSupplyHolds(w.state);
    expect(lotBounds(w.state, 0, 0)).toEqual({ x0: 3, y0: 3, side: 10 });
    w.ok("ada", { type: "lay", x: 3, y: 6, ground: "dirt" });
  });

  it("counts pieces and things on show separately, and its refusal says so (issue #149)", () => {
    const w = world();
    // The issue's shape: 3 pieces, and a thing on show. The old refusal ended by saying what
    // stands on tables, hangs on walls, or is on display "all count", which read as if the
    // seashell filled the pieces count. It never did: the counts are separate (RFC 0052).
    furnish(w, 3);
    stock(w.state, "ada", { seashell: 1 });
    w.ok("ada", { type: "place", x: 10, y: 10, block: "pedestal" });
    w.ok("ada", { type: "display", item: "seashell", x: 10, y: 10 });
    fund(w.state, "ada", LOTS.steps[0].coins);
    const refusal = w.refused("ada", grow);
    expect(refusal.code).toBe("not_eligible");
    expect(refusal.message).toBe(
      "A lot grows to 10 by 10 once the home shows 6 pieces of furniture (it has 3). " +
        "The two counts are separate: pieces are furniture and seats, and things on show " +
        "(what stands on tables, hangs on walls, or is on display) never count as pieces.",
    );
    expect(refusal.message).not.toContain("all count");
    // Three more pieces, and the same home grows: the seashell was never the missing part.
    furnish(w, 3);
    expect(w.ok("ada", grow)).toContainEqual({
      type: "lot_grown",
      px: 0,
      py: 0,
      lot: 10,
      by: "ada",
    });
  });

  it("refuses without the coins", () => {
    const w = world();
    furnish(w, LOTS.steps[0].pieces);
    const purse = w.state.economy?.coins.ada ?? 0;
    if (purse >= LOTS.steps[0].coins) fund(w.state, "ada", -purse);
    expect(w.refused("ada", grow).code).toBe("not_enough_coins");
  });

  it("stops at the whole slot", () => {
    const w = world();
    w.state.lots = { "0,0": 16 };
    expect(w.refused("ada", grow).code).toBe("lot_full");
  });

  it("is only for a plot you build on", () => {
    const w = world();
    w.ok("bo", { type: "join", name: "bo", kind: "human" });
    expect(w.refused("bo", grow).code).toBe("not_your_plot");
  });

  it("stays with the slot when the plot is released", () => {
    const w = world();
    w.ok("bo", { type: "join", name: "bo", kind: "human" });
    w.ok("bo", { type: "settle", px: 2, py: 0 });
    w.state.lots = { "2,0": 12 };
    w.ok("bo", { type: "release" });
    expect(w.state.plots["2,0"]).toBeUndefined();
    expect(lotBounds(w.state, 2, 0).side).toBe(12);
  });

  it("is the whole plot before a regrid, so nothing grows and nothing is refused for it", () => {
    const state = createWorld({
      width: 24,
      height: 24,
      plotSize: 8,
      maxPlotsPerResident: 1,
      reach: 3,
    });
    expect(lotBounds(state, 1, 1)).toEqual({ x0: 8, y0: 8, side: 8 });
    expect(inLot(state, 8, 15)).toBe(true);
  });
});
