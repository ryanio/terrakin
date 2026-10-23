/**
 * Thanksgiving (RFC 0034): the fourth Thursday of November, with its days either side, and a feast
 * in the Commons that night. The feast is a town event the server books; while it's live, a resident
 * in its area brings one dish to the table, which leaves their things for good and is set out for
 * everyone to see. Nothing is paid back: the table is the point.
 */
import { CATALOG, familyPath, type ItemKind } from "./catalog";
import { refuse } from "./check";
import { isTownsfolk } from "./economy";
import { eventArea, inArea, isTownEvent } from "./events";
import { dayName, HOLIDAY_INFO, holidayRun, nextHolidayStart } from "./holiday";
import {
  addStack,
  closed,
  held,
  ITEM_ID_PATTERN,
  inventory,
  inventoryEvent,
  isStackKind,
} from "./items";
import { own, residentById } from "./own";
import { clayOpen, servedTea, TEA } from "./pottery";
import type {
  Command,
  HostedEvent,
  ItemsState,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";

/** The feast's numbers. */
export const FEAST = {
  /** Days from Thanksgiving's first day (the Monday before) to the feast, its Thursday. */
  dayOfFeast: 3,
} as const;

type Mutation = () => WorldEvent[];
export type FeastChecked = Mutation | Rejection;

/** The day of the feast in the run of Thanksgiving `day` is in, or the next one. */
export function feastDay(day: number): number | undefined {
  const first = holidayRun("thanksgiving", day)?.first ?? nextHolidayStart("thanksgiving", day);
  return first === undefined ? undefined : first + FEAST.dayOfFeast;
}

/**
 * Whether a kind can go on the feast's table: something a kitchen makes, a good or a sweet, from
 * the food families (a pie, a jam, a soup, punch, candy). Raw produce and fish stay home.
 */
export function isDish(kind: string): kind is ItemKind {
  if (!Object.hasOwn(CATALOG, kind)) return false;
  // A pot of tea (RFC 0047) is in the pottery family, and it's a dish too.
  if (kind === TEA) return true;
  const entry = CATALOG[kind as keyof typeof CATALOG];
  return (
    (entry.role === "good" || entry.role === "sweet") && familyPath(entry.family).includes("food")
  );
}

/**
 * The feast that's live now: the town's event that started on the feast's day, Thanksgiving's
 * Thursday. Another town event that week, like the Sunday gathering, isn't the feast.
 */
export function liveFeast(state: WorldState): HostedEvent | undefined {
  const day = state.day;
  const run = day === undefined ? undefined : holidayRun("thanksgiving", day);
  if (!run) return undefined;
  const on = run.first + FEAST.dayOfFeast;
  return state.events?.list.find((e) => isTownEvent(e) && e.status === "live" && e.day === on);
}

/**
 * The feast on the day it's held, scheduled or live: the town's event that starts on Thanksgiving's
 * Thursday. Undefined on any other day, and once it has ended.
 */
export function feastToday(state: WorldState): HostedEvent | undefined {
  const day = state.day;
  const run = day === undefined ? undefined : holidayRun("thanksgiving", day);
  if (!run) return undefined;
  const on = run.first + FEAST.dayOfFeast;
  return state.events?.list.find(
    (e) => isTownEvent(e) && e.day === on && (e.status === "scheduled" || e.status === "live"),
  );
}

/** Whether `actor` has brought a dish to `event` already. */
export const broughtTo = (event: HostedEvent, actor: ResidentId) =>
  (event.dishes ?? []).some((d) => d.by === actor);

/**
 * `bring_dish {item}`: set one dish on the feast's table, from your things. `item` is a made
 * thing's id (a pie, a jam) or a sweet's kind (candy). One a resident a feast.
 */
export function checkBringDish(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "bring_dish" }>,
): FeastChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = residentById(state, actor);
  if (!me) return refuse("not_joined", "Join the world first.");
  // A host serves a pot of tea at their own event (RFC 0047), once pottery is open.
  const hosting = clayOpen(state) ? liveEventsHostedBy(state, actor) : [];
  const here = hosting.find(
    (e) => (me.floor ?? 0) === 0 && inArea(eventArea(state.config, e.px, e.py), me.x, me.y),
  );
  if (here) return checkServeTea(items, actor, here, command.item);
  const feast = liveFeast(state);
  const away = hosting[0];
  if (!feast && away) {
    return refuse(
      "not_at_feast",
      `Your event is on at plot (${away.px}, ${away.py}): stand in its area, on the ground floor, to serve tea there.`,
    );
  }
  if (!feast) {
    const on = feastDay(day);
    return refuse(
      "out_of_holiday",
      on === undefined
        ? `There's no feast on now. It's in the Commons on the Thursday of ${HOLIDAY_INFO.thanksgiving.name}.`
        : `There's no feast on now. The ${HOLIDAY_INFO.thanksgiving.name} feast is in the Commons on ${dayName(on)} in the evening (UTC): GET /v1/events lists it.`,
    );
  }
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk host the feast; residents bring the dishes.");
  }
  if ((me.floor ?? 0) !== 0 || !inArea(eventArea(state.config, feast.px, feast.py), me.x, me.y)) {
    return refuse(
      "not_at_feast",
      `Come to the feast in the Commons first: {"type": "join_event", "event": "${feast.id}"} takes you there.`,
    );
  }
  if (broughtTo(feast, actor)) {
    return refuse("already_brought", "You've brought a dish to this feast already. Thank you!");
  }
  const { item } = command;
  const mine = own(items.inventories, actor);
  if (typeof item === "string" && ITEM_ID_PATTERN.test(item)) {
    const good = mine?.goods.find((g) => g.id === item);
    if (!good) return refuse("not_enough_items", "You don't hold a thing with that id.");
    if (!isDish(good.kind)) return notFood();
    return () => {
      const inv = inventory(items, actor);
      inv.goods = inv.goods.filter((g) => g.id !== item);
      return bring(feast, actor, good.kind, inventoryEvent(actor, "brought", [], { lost: [item] }));
    };
  }
  if (typeof item === "string" && isDish(item) && !isStackKind(item)) {
    return refuse(
      "not_food",
      "That's a made thing: bring it by its id, like i_12. GET /v1/inventory lists the ids of what you hold.",
    );
  }
  if (typeof item !== "string" || !isStackKind(item) || !isDish(item)) return notFood();
  if (held(mine, item) < 1) return refuse("not_enough_items", "You don't have one of those.");
  return () => {
    const change = addStack(inventory(items, actor), item, -1);
    return bring(feast, actor, item, inventoryEvent(actor, "brought", [change]));
  };
}

/** The live events `actor` hosts (RFC 0047): where they serve tea. */
const liveEventsHostedBy = (state: WorldState, actor: ResidentId): HostedEvent[] =>
  (state.events?.list ?? []).filter((e) => e.status === "live" && e.host === actor);

/**
 * `bring_dish {item}` from a host at their own live event (RFC 0047): a pot of tea of theirs, by its
 * id, set out for the guests, once an event. It leaves their things, and when the server credits
 * the event the host earns `POTTERY.teaPerGuest` more Hosting points a counted guest.
 */
function checkServeTea(
  items: ItemsState,
  actor: ResidentId,
  event: HostedEvent,
  item: unknown,
): FeastChecked {
  if (servedTea(event)) {
    return refuse("already_brought", "You've served tea at this event already. Enjoy it!");
  }
  const good =
    typeof item === "string" && ITEM_ID_PATTERN.test(item)
      ? own(items.inventories, actor)?.goods.find((g) => g.id === item)
      : undefined;
  if (good?.kind !== TEA) {
    return refuse(
      good ? "not_food" : "not_enough_items",
      `At your own event, the dish you set out is a pot of tea, by its id: brew one at a kitchen with a teapot and ${CATALOG[TEA].recipe?.needs.herb} bunches of herbs.`,
    );
  }
  return () => {
    const inv = inventory(items, actor);
    inv.goods = inv.goods.filter((g) => g.id !== good.id);
    return bring(event, actor, TEA, inventoryEvent(actor, "brought", [], { lost: [good.id] }));
  };
}

const notFood = () =>
  refuse(
    "not_food",
    "Bring something from a kitchen: a pie, a jam, a soup, a drink, or a sweet, by its id or, for a sweet, its kind.",
  );

/** Set `kind` on the feast's table for `actor`, after their own `inventory` event. */
function bring(feast: HostedEvent, actor: ResidentId, kind: ItemKind, taken: WorldEvent) {
  feast.dishes = [...(feast.dishes ?? []), { by: actor, kind }];
  return [taken, { type: "dish_brought", by: actor, kind, event: feast.id } as WorldEvent];
}
