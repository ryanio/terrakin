/**
 * Coins (RFC 0008, phase 1): the numbers. Every amount is a whole number of coins.
 *
 * `scripts/economy-sim.ts` plays a month of a few hundred residents with these numbers and prints
 * supply per active resident. Change a number here, rerun it, and record why in a decision
 * (decision 0037 has the reasoning behind the current ones).
 */
export const ECONOMY = {
  /** Coins the treasury opens with, minted by `open_economy`. */
  treasuryOpening: 5_000,
  /** Coins minted into the treasury at each `new_day`. */
  treasuryMint: 700,
  /** Minted the first time each day a resident stands on their own hearth. */
  allowance: 10,
  /** Days in a row of allowance that start the streak bonus. */
  streakDays: 7,
  /** Minted on top of the allowance on each day of a streak, from day `streakDays` on. */
  streakBonus: 5,
  /** Paid from the treasury the first time a resident gets a plot while the economy is open. */
  welcomeGift: 50,
  /** Each townsfolk resident's daily budget, from the treasury at `new_day`. */
  townsfolkBudget: 50,
  /**
   * Townsfolk budgets come only from what the treasury holds above this, so welcome gifts for
   * newcomers stay funded on a busy day.
   */
  budgetReserve: 1_000,
  /** The most all townsfolk together may give one resident in a day. */
  townsfolkPerResident: 25,
  /** The most a resident may give in gifts in a day. */
  giveCap: 200,
  /** The most a resident may receive in gifts in a day. */
  receiveCap: 500,
  /** Gift notes, in characters. */
  noteMax: 140,
  /** Ledger lines kept for each resident and for the treasury. */
  ledgerMax: 50,
} as const;
