/**
 * Halloween's own rules (RFC 0022): trick-or-treating on October 31.
 *
 * A resident at a neighbor's door (on their plot or beside it) knocks with `trick_or_treat`, once a
 * door a day, and goes home with a candy. It comes from whoever lives there and is home (online and
 * on the plot) with candy, else, when a candy bowl stands on the plot, from the first of them who
 * holds any, home or not, else from the town, which hands out a few a day at each door and a set
 * number across town. When none of those has a candy, the knock is refused and nothing moves.
 *
 * Nothing here is random, so a knock replays from the state alone. Today's knocks live in
 * `state.knocks`, absent until the day's first and dropped at `new_day`.
 */
import { isWhole, refuse } from "./check";
import { isTownsfolk, sameHousehold } from "./economy";
import { dayName, dayOn, HOLIDAY_INFO, holidayOf, type MonthDate, nextDayOn } from "./holiday";
import { addStack, closed, held, ITEMS, inventory, inventoryEvent, inventorySize } from "./items";
import { plotKey, tileKey } from "./keys";
import { residentById } from "./own";
import { dateOfDay } from "./season";
import type {
  CandyFrom,
  Command,
  ItemsState,
  KnocksState,
  Plot,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, isCommons, plotDistance, plotInBounds, plotOf } from "./world";

/** The numbers (decision 0107). */
export const TRICK_OR_TREAT = {
  /** The night: October 31, by the UTC calendar, during Halloween. */
  on: { month: 10, date: 31 } as MonthDate,
  /** Doors one resident can knock on in a day, each once. */
  doorsPerDay: 10,
  /** Candy the town hands out at one door in a day, when nobody there has any to give. */
  townPerDoor: 5,
  /** Candy the town hands out in a day, across every door. */
  townPerDay: 250,
} as const;

/** The candy everyone hands out. */
export const CANDY = "candy" as const;

/** The decor that hands out its owner's candy while they're away. */
export const CANDY_BOWL = "candy_bowl" as const;

/** Whether `day` is trick-or-treat night: October 31, inside Halloween. */
export function trickOrTreatDay(day: number | undefined): boolean {
  if (day === undefined || holidayOf(day) !== "halloween") return false;
  const { month, date } = dateOfDay(day);
  return month === TRICK_OR_TREAT.on.month && date === TRICK_OR_TREAT.on.date;
}

/** The next trick-or-treat night on or after `day`. */
export const nextTrickOrTreat = (day: number) => nextDayOn(TRICK_OR_TREAT.on, day);

/** Trick-or-treat night in the year of `day`. */
export const trickOrTreatIn = (day: number) => dayOn(dateOfDay(day).year, TRICK_OR_TREAT.on);

/** Who lives on a plot, in the order they answer the door: its owner, then each co-owner. */
const residentsOf = (plot: Plot) => [plot.ownerId, ...(plot.coOwners ?? [])];

/** Whether a candy bowl stands on plot (px, py). */
function hasBowl(state: WorldState, px: number, py: number): boolean {
  const size = state.config.plotSize;
  for (let y = py * size; y < (py + 1) * size; y++) {
    for (let x = px * size; x < (px + 1) * size; x++) {
      if (state.blocks[tileKey(x, y)] === CANDY_BOWL) return true;
    }
  }
  return false;
}

/** Candy the town handed out today, at every door. */
const townToday = (knocks: KnocksState | undefined) =>
  Object.values(knocks?.town ?? {}).reduce((sum, n) => sum + n, 0);

/**
 * Where a knock's candy would come from, or undefined when nobody has one for it: someone home
 * with candy, else a bowl's owner with candy, else the town while it has candy left.
 */
export function candyFor(
  state: WorldState,
  plot: Plot,
): { from: CandyFrom; giver?: ResidentId } | undefined {
  const items = state.items;
  if (!items) return undefined;
  const has = (id: ResidentId) => held(items.inventories[id], CANDY) > 0;
  const home = residentsOf(plot).find((id) => {
    const r = residentById(state, id);
    if (!r?.online) return false;
    const at = plotOf(state.config, r.x, r.y);
    return at.px === plot.px && at.py === plot.py && has(id);
  });
  if (home) return { from: "resident", giver: home };
  if (hasBowl(state, plot.px, plot.py)) {
    const owner = residentsOf(plot).find(has);
    if (owner) return { from: "bowl", giver: owner };
  }
  const key = plotKey(plot.px, plot.py);
  const atDoor = state.knocks?.town[key] ?? 0;
  if (atDoor < TRICK_OR_TREAT.townPerDoor && townToday(state.knocks) < TRICK_OR_TREAT.townPerDay) {
    return { from: "town" };
  }
  return undefined;
}

type Mutation = () => WorldEvent[];
export type HalloweenChecked = Mutation | Rejection;

/** `trick_or_treat {px, py}`: knock at a neighbor's door on Halloween night and get a candy. */
export function checkTrickOrTreat(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "trick_or_treat" }>,
): HalloweenChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = residentById(state, actor);
  if (!me) return refuse("not_joined", "Join the world first.");
  if (!trickOrTreatDay(day)) {
    const night = nextTrickOrTreat(day);
    return refuse(
      "out_of_holiday",
      `Trick-or-treating is on October 31 (UTC), the night of ${HOLIDAY_INFO.halloween.name}. The next one is ${dayName(night)}, ${dateOfDay(night).year}.`,
    );
  }
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk hand candy out; they don't go trick-or-treating.");
  }
  if (!me.hearth) {
    return refuse(
      "no_hearth",
      "Trick-or-treaters bring their candy home, so set a hearth first. Try build_starter_home, which sets one for you.",
    );
  }
  const { px, py } = command;
  if (!isWhole(px) || !isWhole(py) || !plotInBounds(state.config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(state.config, px, py)) {
    return refuse(
      "plot_is_commons",
      "The Commons is everyone's, so it has no door to knock on. Try a neighbor's plot.",
    );
  }
  const key = plotKey(px, py);
  const plot = state.plots[key];
  if (!plot) {
    return refuse(
      "plot_unclaimed",
      "Nobody lives there, so nobody answers. Try a neighbor's plot.",
    );
  }
  if (canBuildOn(plot, actor) || residentsOf(plot).some((id) => sameHousehold(state, actor, id))) {
    return refuse(
      "own_plot",
      "That's your own door, or your household's. Knock at a neighbor's: GET /v1/plots lists them.",
    );
  }
  if (plotDistance(state.config, me, px, py) > 1) {
    return refuse(
      "out_of_reach",
      `Knock from their plot or right beside it. Try {"type": "visit", "px": ${px}, "py": ${py}} to go to their door first.`,
    );
  }
  const doors = state.knocks?.by[actor] ?? [];
  if (doors.includes(key)) {
    return refuse(
      "already_knocked",
      "You knocked here tonight already. Try another neighbor's door.",
    );
  }
  if (doors.length >= TRICK_OR_TREAT.doorsPerDay) {
    return refuse(
      "knock_limit",
      `You've knocked on ${TRICK_OR_TREAT.doorsPerDay} doors tonight, which is all one night has. Enjoy your candy.`,
    );
  }
  if (inventorySize(items.inventories[actor]) + 1 > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and a candy needs room for one more.`,
    );
  }
  const candy = candyFor(state, plot);
  if (!candy) {
    return refuse(
      "no_candy",
      "Nobody here has candy for you, and the town has handed out all it can at this door tonight. Try another neighbor's door.",
    );
  }
  return () => {
    const knocks: KnocksState = state.knocks ?? { by: {}, town: {} };
    state.knocks = knocks;
    knocks.by[actor] = [...doors, key];
    const events: WorldEvent[] = [
      {
        type: "trick_or_treated",
        by: actor,
        px,
        py,
        from: candy.from,
        ...(candy.giver ? { giver: candy.giver } : {}),
      },
    ];
    if (candy.giver) {
      const out = addStack(inventory(items, candy.giver), CANDY, -1);
      events.push(inventoryEvent(candy.giver, "handed_out", [out], { with: actor }));
    } else {
      knocks.town[key] = (knocks.town[key] ?? 0) + 1;
    }
    const into = addStack(inventory(items, actor), CANDY, 1);
    events.push(
      inventoryEvent(actor, "trick_or_treat", [into], candy.giver ? { with: candy.giver } : {}),
    );
    return events;
  };
}

/** What `new_day` does to trick-or-treating, or null when nobody knocked: the night's knocks go. */
export function halloweenNewDay(state: WorldState): Mutation | null {
  if (!state.knocks) return null;
  return () => {
    delete state.knocks;
    return [];
  };
}

/** The doors a resident knocked on today, as plot keys. */
export const knockedToday = (state: WorldState, id: ResidentId): readonly string[] =>
  state.knocks?.by[id] ?? [];
