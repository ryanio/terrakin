import { coinCount, isWhole, refuse } from "./check";
import { allowanceDue, movePurse, moveTreasury, treasuryShareOf } from "./economy";
import { furnishing } from "./furnished";
import { plotKey } from "./keys";
import { plotListedProblem } from "./plot-market";
import type { Command, Rejection, ResidentId, WorldEvent, WorldState } from "./types";
import { canBuildOn, isCommons, plotInBounds, plotOf } from "./world";

/**
 * Lots (RFC 0052): the square in the middle of a plot slot its owners can build on. A lot starts
 * at `LOTS.first` tiles a side and grows by `grow_lot` to the whole slot. Before the world is
 * regridded a slot is 8 tiles, so every lot is the whole slot and nothing about building changes.
 * The rest of a slot past its lot is the wild yard: walked, gathered, never built on.
 */

/** A lot's sizes and what each step asks. Frozen once a live world grows a lot. */
export const LOTS = {
  /** Tiles a side a lot starts at. */
  first: 8,
  /** Each step: the side it grows to, its price, and how furnished the home must be. */
  steps: [
    { side: 10, coins: 150, pieces: 6, onShow: 0 },
    { side: 12, coins: 300, pieces: 12, onShow: 4 },
    { side: 14, coins: 600, pieces: 20, onShow: 10 },
    { side: 16, coins: 1000, pieces: 30, onShow: 20 },
  ],
} as const;

/**
 * The side of slot (px, py)'s lot: what it grew to, else the first size, never past the slot. A
 * lot is kept on the world by slot (`state.lots`), so a sale or a release keeps it.
 */
export function lotSide(state: Pick<WorldState, "config" | "lots">, px: number, py: number) {
  const slot = state.config.plotSize;
  return Math.min(state.lots?.[plotKey(px, py)] ?? LOTS.first, slot);
}

/** The lot's corner tile on slot (px, py), and its side. */
export function lotBounds(
  state: Pick<WorldState, "config" | "lots">,
  px: number,
  py: number,
): { x0: number; y0: number; side: number } {
  const slot = state.config.plotSize;
  const side = lotSide(state, px, py);
  const inset = Math.floor((slot - side) / 2);
  return { x0: px * slot + inset, y0: py * slot + inset, side };
}

/** Whether (x, y) is inside the lot of the slot it's on. */
export function inLot(state: Pick<WorldState, "config" | "lots">, x: number, y: number): boolean {
  const { px, py } = plotOf(state.config, x, y);
  const { x0, y0, side } = lotBounds(state, px, py);
  return x >= x0 && x < x0 + side && y >= y0 && y < y0 + side;
}

/**
 * `outside_lot` for building on (x, y) past its plot's lot, or null. It names the first size whose
 * lot holds the tile, how many `grow_lot` steps away that is, and the next step.
 */
export function outsideLotProblem(
  state: Pick<WorldState, "config" | "lots">,
  x: number,
  y: number,
): Rejection | null {
  if (inLot(state, x, y)) return null;
  const slot = state.config.plotSize;
  const { px, py } = plotOf(state.config, x, y);
  const { side } = lotBounds(state, px, py);
  const ahead = LOTS.steps.filter((s) => s.side > side && s.side <= slot);
  const holds = (grown: number) => {
    const inset = Math.floor((slot - grown) / 2);
    const dx = x - px * slot;
    const dy = y - py * slot;
    return dx >= inset && dx < inset + grown && dy >= inset && dy < inset + grown;
  };
  const reach = ahead.findIndex((s) => holds(s.side));
  const lot = `this plot's lot of ${side} by ${side}`;
  const next = ahead[0];
  if (!next) return refuse("outside_lot", `That's past ${lot}, where nothing is built.`);
  const nextWords = `grow_lot at px ${px}, py ${py} grows it to ${next.side} by ${next.side}`;
  if (reach === 0) {
    return refuse(
      "outside_lot",
      `That's in the wild yard, past ${lot}. ${nextWords}, which reaches it.`,
    );
  }
  const at = ahead[reach]?.side;
  if (at === undefined) {
    return refuse(
      "outside_lot",
      `That's in the wild yard, past ${lot}, and no lot size reaches it. ${nextWords}.`,
    );
  }
  return refuse(
    "outside_lot",
    `That's in the wild yard, past ${lot}. A lot of ${at} by ${at} reaches it, ${reach + 1} grow_lot steps from now; ${nextWords} first.`,
  );
}

/** The step a lot of `side` grows by next in a slot of `slot` tiles, or undefined at the slot. */
export function nextLotStep(side: number, slot: number) {
  return LOTS.steps.find((s) => s.side > side && s.side <= slot);
}

/** `grow_lot {px, py}`: grows the lot on a plot you own or share by one step. */
export function checkGrowLot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "grow_lot" }>,
): (() => WorldEvent[]) | Rejection {
  const { px, py } = command;
  if (!isWhole(px) || !isWhole(py) || !plotInBounds(state.config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(state, px, py)) {
    return refuse("plot_is_commons", "The Commons is everyone's. Grow your own plot's lot.");
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse("not_your_plot", "You can grow the lot only of a plot you own or share.");
  }
  const listed = plotListedProblem(state, px, py);
  if (listed) return listed;
  const side = lotSide(state, px, py);
  const step = nextLotStep(side, state.config.plotSize);
  if (!step) {
    return refuse(
      "lot_full",
      side >= state.config.plotSize
        ? `This lot is the whole plot, ${side} by ${side}.`
        : `This lot is as big as lots grow, ${side} by ${side}.`,
    );
  }
  const has = furnishing(state, px, py);
  const shown = has.onSurfaces + has.onWalls + has.onDisplay;
  if (has.pieces < step.pieces || shown < step.onShow) {
    const want = [
      has.pieces < step.pieces ? `${step.pieces} pieces of furniture (it has ${has.pieces})` : "",
      shown < step.onShow ? `${step.onShow} things on show (it has ${shown})` : "",
    ].filter(Boolean);
    return refuse(
      "not_eligible",
      `A lot grows to ${step.side} by ${step.side} once the home shows ${want.join(" and ")}. Furniture, seats, and what stands on tables, hangs on walls, or is on display all count.`,
    );
  }
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) {
    return refuse("economy_closed", "Growing a lot costs coins, and coins aren't open yet.");
  }
  const purse = econ.coins[actor] ?? 0;
  if (purse < step.coins) {
    const tip = allowanceDue(state, actor)
      ? "Today's allowance is waiting: send home first."
      : "Come home each day for your allowance.";
    return refuse(
      "not_enough_coins",
      `Growing the lot to ${step.side} by ${step.side} is ${coinCount(step.coins)}, and you have ${coinCount(purse)}. ${tip}`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const toTreasury = Math.floor((step.coins * treasuryShareOf(state)) / 100);
  return () => {
    state.lots = { ...state.lots, [plotKey(px, py)]: step.side };
    const events: WorldEvent[] = [
      { type: "lot_grown", px, py, lot: step.side, by: actor },
      movePurse(econ, actor, -step.coins, "lot", at),
    ];
    // The treasury's history is public, so its share is a line that doesn't say who paid.
    if (toTreasury > 0) events.push(moveTreasury(econ, toTreasury, "lot", at));
    econ.burned += step.coins - toTreasury;
    return events;
  };
}
