import { coinCount as coins, isWhole, refuse } from "./check";
import {
  ECONOMY,
  isTownsfolk,
  movePurse,
  moveTreasury,
  sameHousehold,
  treasurySpare,
} from "./economy";
import { residentById } from "./own";
import { townEligibility } from "./town";
import type { Award, Rejection, ResidentId, WorldEvent, WorldState } from "./types";

/**
 * Recognition awards (RFC 0036): treasury coins a maintainer gives a resident for outstanding
 * work, with no vote and no second maintainer.
 *
 * This is the one place town money moves on one person's word, which [decision 0062] otherwise
 * refuses. What stands in for the second key is the cap and the daylight: `AWARDS.max` an award,
 * `AWARDS.perMonth` across the rolling window, the treasury's reserve respected, and an award
 * inside the awarding maintainer's own household marked, so it cannot be done quietly. That mark
 * goes on the treasury's ledger line as well as the event, because events are not stored and an
 * award paid while nobody held a socket would otherwise leave no trace of the household at all.
 * Vote-passed grants are untouched and still need `confirm_town_bounty` from a maintainer outside
 * both households.
 *
 * Nothing is minted. Coins move out of the treasury into a purse, so
 * `sum(coins) + treasury + bountyHeld + eventHeld == minted - burned` holds unchanged.
 */

/**
 * The numbers. Every amount is a whole number of coins.
 *
 * These carry the whole weight of the design, since no second maintainer does. Once a live world
 * holds an award, changing one changes how logged inputs replay, so it needs a logged switch.
 */
export const AWARDS = {
  /** The most one award pays. `ECONOMY.giveCap`, so an award is never more than a resident could give in a day. */
  max: 200,
  /** The most every award together may pay inside `windowDays`. */
  perMonth: 1_000,
  /** World days the `perMonth` cap is counted over, counting back from the day of the award. */
  windowDays: 30,
} as const;

type Mutation = () => WorldEvent[];

/** The awards still inside the window ending on `day`. */
const inWindow = (state: WorldState, day: number): Award[] =>
  (state.awards ?? []).filter((a) => day - a.day < AWARDS.windowDays);

/** What awards have paid inside the window ending on `day`. The staff view reads it back. */
export const awardedInWindow = (state: WorldState, day: number): number =>
  inWindow(state, day).reduce((n, a) => n + a.coins, 0);

export function checkAwardGrant(
  state: WorldState,
  command: { to: ResidentId; coins: number; by: string; resident: ResidentId },
): Mutation | Rejection {
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) return refuse("economy_closed", "Coins aren't open yet.");
  const { to, by, resident } = command;
  if (typeof by !== "string" || by === "") {
    return refuse("server_only", "Say which maintainer awarded it.");
  }
  // The awarding maintainer's own resident is required, not optional as it is on
  // `confirm_town_bounty`. The household mark is the only disclosure this design has, so an award
  // the sim cannot place in a household is refused rather than paid unmarked (RFC 0036). Map every
  // maintainer's email in TERRAKIN_STAFF_RESIDENTS.
  if (typeof resident !== "string" || !residentById(state, resident)) {
    return refuse(
      "server_only",
      "Say which resident the maintainer is, so the household is known.",
    );
  }
  if (!residentById(state, to)) return refuse("unknown_resident", "No such resident.");
  if (!isWhole(command.coins) || command.coins < 1 || command.coins > AWARDS.max) {
    return refuse("invalid_amount", `An award pays 1 to ${coins(AWARDS.max)}.`);
  }
  if (isTownsfolk(state, to)) {
    return refuse("not_eligible", "Townsfolk aren't awarded. Their coins are the town's.");
  }
  const ok = townEligibility(state, to);
  if (!ok.eligible) return refuse("not_eligible", ok.message);
  if (command.coins > treasurySpare(econ)) {
    return refuse(
      "not_enough_coins",
      `The treasury keeps ${coins(ECONOMY.budgetReserve)} for welcome gifts, so it can spare ${coins(treasurySpare(econ))}.`,
    );
  }
  const already = awardedInWindow(state, day);
  if (already + command.coins > AWARDS.perMonth) {
    // `gift_limit`, not a code of its own: `award_grant` is server-only, so no agent can ever be
    // told this, and a new member of ERROR_CODES would make SKILL.md document an unreachable
    // error. `test_grant` reuses existing codes for the same reason.
    return refuse(
      "gift_limit",
      `Awards pay ${coins(AWARDS.perMonth)} in ${AWARDS.windowDays} days, and ${coins(already)} of that is used. ${coins(AWARDS.perMonth - already)} left.`,
    );
  }
  // An award to the awarding maintainer's own household is allowed and marked, never refused
  // (RFC 0036). That mark is the disclosure that stands in for a second maintainer.
  const household = sameHousehold(state, resident, to);
  const at = { seq: state.seq + 1, day };
  const amount = command.coins;
  const mark = household ? { household: true as const } : {};
  return () => {
    const kept = inWindow(state, day);
    state.awards = [...kept, { ...at, to, coins: amount, by, ...mark }];
    return [
      // The mark goes on the ledger line, not only on the event: the line is the only durable
      // public record of an award, and an event nobody was connected for is seen by nobody.
      moveTreasury(econ, -amount, "award", at, to, mark),
      movePurse(econ, to, amount, "award", at),
      { type: "award_paid", to, amount, ...mark },
    ];
  };
}
