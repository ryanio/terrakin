/**
 * New Year's (RFC 0034): fireworks, bought from the shop while it runs and set off on December 31
 * and January 1 (UTC), each its own night like Halloween's two. A firework bursts over a tile on
 * your own ground or in the Commons, near you, in one of six colors. Drawing only, past that: the
 * world keeps nothing of it but the count toward the night's limit.
 */
import { isWhole, refuse } from "./check";
import { addStack, closed, held, inventory, inventoryEvent } from "./items";
import { own, residentById } from "./own";
import { dateOfDay } from "./season";
import {
  type Command,
  FIREWORK_COLORS,
  type ItemsState,
  type Rejection,
  type ResidentId,
  type WorldEvent,
  type WorldState,
} from "./types";
import { canBuildOn, inBounds, isCommons, plotOf } from "./world";

/** Fireworks' numbers. */
export const FIREWORKS = {
  /** Fireworks a resident sets off a night at most. */
  perNight: 20,
  /** How far from you, in tiles either way, a firework goes up. */
  reach: 3,
} as const;

/** Whether `day` is a fireworks night: December 31 or January 1 (UTC). */
export function fireworkNight(day: number | undefined): boolean {
  if (day === undefined) return false;
  const { month, date } = dateOfDay(day);
  return (month === 12 && date === 31) || (month === 1 && date === 1);
}

/** `set_off_firework {x, y, color}`: one firework from your things, over a tile near you. */
export function checkSetOffFirework(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_off_firework" }>,
): (() => WorldEvent[]) | Rejection {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const me = residentById(state, actor);
  if (!me) return refuse("not_joined", "Join the world first.");
  if (!fireworkNight(state.day)) {
    return refuse(
      "out_of_holiday",
      "Fireworks go up on New Year's Eve and New Year's Day, December 31 and January 1 (UTC).",
    );
  }
  const { x, y, color } = command;
  if (!(FIREWORK_COLORS as readonly string[]).includes(color)) {
    return refuse("bad_color", `A firework is ${FIREWORK_COLORS.join(", ")}.`);
  }
  if (!isWhole(x) || !isWhole(y) || !inBounds(state.config, x, y)) {
    return refuse("out_of_bounds", "That tile is outside the world.");
  }
  if (Math.abs(x - me.x) > FIREWORKS.reach || Math.abs(y - me.y) > FIREWORKS.reach) {
    return refuse("out_of_reach", `Set it off within ${FIREWORKS.reach} tiles of you.`);
  }
  const { px, py } = plotOf(state.config, x, y);
  const plot = state.plots[`${px},${py}`];
  if (!isCommons(state.config, px, py) && !(plot && canBuildOn(plot, actor))) {
    return refuse(
      "not_your_plot",
      "Set fireworks off over your own plot or the Commons, never over a neighbor's.",
    );
  }
  const inv = own(items.inventories, actor);
  if (held(inv, "firework") < 1) {
    return refuse(
      "not_enough_items",
      "You have no fireworks. The shop sells them over New Year's.",
    );
  }
  const tonight = own(items.today.fireworks, actor) ?? 0;
  if (tonight >= FIREWORKS.perNight) {
    return refuse(
      "firework_limit",
      `You've set off ${FIREWORKS.perNight} tonight, all one night has.`,
    );
  }
  return () => {
    items.today.fireworks = { ...items.today.fireworks, [actor]: tonight + 1 };
    const change = addStack(inventory(items, actor), "firework", -1);
    return [
      inventoryEvent(actor, "firework", [change]),
      { type: "firework", by: actor, x, y, color },
    ];
  };
}
