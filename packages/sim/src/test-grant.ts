import { STACK_KINDS, type StackKind } from "./catalog";
import { isWhole, refuse } from "./check";
import { movePurse, moveTreasury } from "./economy";
import { addStack, ITEMS, inventory, inventoryEvent, inventorySize } from "./items";
import { residentById } from "./own";
import type { Rejection, ResidentId, WorldEvent, WorldState } from "./types";

/**
 * `test_grant {to, coins?, stacks?}`: coins from the treasury and stacks of things for one
 * resident, so a test or a local check can start a resident at a stage real play takes days to
 * reach (decision 0147). Only TOWN_ACTOR sends it, and the server sends it only from its test route,
 * which production can't turn on. Coins move out of the treasury as a grant, so nothing is minted
 * and `sum(coins) + treasury == minted - burned` still holds. Its lines read like real ones (a Town
 * Hall grant in the purse, a shop purchase in your things), which a test world can live with.
 */

type Mutation = () => WorldEvent[];

/** The most a single grant gives: enough for any test, small enough to spot by eye. */
export const TEST_GRANT = { coinsMax: 100_000, unitsMax: ITEMS.inventoryMax } as const;

export function checkTestGrant(
  state: WorldState,
  command: { to: ResidentId; coins?: number; stacks?: Partial<Record<string, number>> },
): Mutation | Rejection {
  const { economy: econ, items } = state;
  if (!residentById(state, command.to)) return refuse("unknown_resident", "No such resident.");
  const coins = command.coins ?? 0;
  if (!isWhole(coins) || coins < 0 || coins > TEST_GRANT.coinsMax) {
    return refuse("invalid_amount", `Grant 0 to ${TEST_GRANT.coinsMax} coins.`);
  }
  if (coins > 0 && !econ) return refuse("economy_closed", "The economy isn't open yet.");
  if (econ && coins > econ.treasury) {
    return refuse("not_enough_coins", `The treasury has ${econ.treasury} coins.`);
  }
  const stacks: [StackKind, number][] = [];
  for (const [kind, count] of Object.entries(command.stacks ?? {})) {
    if (!(STACK_KINDS as readonly string[]).includes(kind)) {
      return refuse("unknown_item", `${kind} isn't something that stacks.`);
    }
    if (!isWhole(count) || count < 1) return refuse("invalid_amount", `Grant 1 or more ${kind}.`);
    stacks.push([kind as StackKind, count]);
  }
  if (stacks.length > 0 && !items) return refuse("items_closed", "Items aren't open yet.");
  const units = stacks.reduce((n, [, count]) => n + count, 0);
  if (items && inventorySize(items.inventories[command.to]) + units > TEST_GRANT.unitsMax) {
    return refuse("inventory_full", `A resident holds at most ${TEST_GRANT.unitsMax} things.`);
  }
  if (coins === 0 && stacks.length === 0) return refuse("invalid_amount", "Grant something.");
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  return () => {
    const events: WorldEvent[] = [];
    if (econ && coins > 0) {
      events.push(moveTreasury(econ, -coins, "grant", at, command.to));
      events.push(movePurse(econ, command.to, coins, "grant", at));
    }
    if (items && stacks.length > 0) {
      const inv = inventory(items, command.to);
      const changes = stacks.map(([kind, count]) => addStack(inv, kind, count));
      events.push(inventoryEvent(command.to, "bought", changes));
    }
    return events;
  };
}
