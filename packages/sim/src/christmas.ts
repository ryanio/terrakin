/**
 * Christmas inside Midwinter (RFC 0034): presents, wrapped with `give` from December 1 to 25 and
 * held out of their recipient's things until they open them, from December 25. Presents still
 * wrapped open themselves at the first `new_day` of the new year, as many as fit. On December 25
 * the town leaves a present of candy canes for each resident with a hearth and none waiting.
 */
import { refuse } from "./check";
import { isTownsfolk } from "./economy";
import { addStack, closed, ITEMS, inventory, inventoryEvent, inventorySize } from "./items";
import { own, residentById } from "./own";
import { dateOfDay, dayOfDate } from "./season";
import {
  type Command,
  type ItemsState,
  type Present,
  type Rejection,
  type ResidentId,
  TOWN_ACTOR,
  type WorldEvent,
  type WorldState,
} from "./types";

/** Presents' numbers. */
export const PRESENTS = {
  /** Wrapping runs from December 1 to this date, both included. */
  wrapUntil: 25,
  /** A present opens from this date of December. */
  openFrom: 25,
  /** Candy canes in the town's present. */
  townCanes: 3,
} as const;

type Mutation = () => WorldEvent[];

/** Whether `day` is one presents can be wrapped on: December 1 to 25. */
export function wrapDay(day: number): boolean {
  const { month, date } = dateOfDay(day);
  return month === 12 && date <= PRESENTS.wrapUntil;
}

/** The first day a present wrapped on `wrapped` can be opened: December 25 of that year. */
export const openDayOf = (wrapped: number) =>
  dayOfDate(dateOfDay(wrapped).year, 12, PRESENTS.openFrom);

/** The presents waiting for `id`, oldest first. */
export const presentsFor = (state: WorldState, id: ResidentId): Present[] =>
  Object.values(state.items?.presents ?? {})
    .filter((p) => p.to === id)
    .sort((a, b) => Number(a.id.slice(8)) - Number(b.id.slice(8)));

/** Make a present and hand its id out, starting the counter on first use. Call only when committing. */
export function addPresent(items: ItemsState, present: Omit<Present, "id">): string {
  const n = items.nextPresent ?? 1;
  const id = `present_${n}`;
  items.nextPresent = n + 1;
  items.presents = { ...items.presents, [id]: { id, ...present } };
  return id;
}

/** Move a present into its recipient's things, and its events. Call only when committing. */
function unwrap(items: ItemsState, present: Present): WorldEvent[] {
  const inv = inventory(items, present.to);
  delete items.presents?.[present.id];
  if (items.presents && Object.keys(items.presents).length === 0) delete items.presents;
  const opened = inventoryEvent(
    present.to,
    "present",
    present.goods ? [] : [addStack(inv, present.kind as never, present.count)],
    present.goods ? { gained: present.goods, with: present.from } : { with: present.from },
  );
  if (present.goods) inv.goods.push(...present.goods.map((g) => ({ ...g })));
  return [
    opened,
    { type: "present_opened", by: present.to, from: present.from, present: present.id },
  ];
}

/** `open_present {present}`: open one of yours, from December 25, when its things fit in yours. */
export function checkOpenPresent(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "open_present" }>,
): Mutation | Rejection {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const present = own(items.presents, command.present);
  if (!present || present.to !== actor) {
    return refuse(
      "unknown_present",
      "No present of yours has that id. GET /v1/inventory lists them.",
    );
  }
  const day = state.day as number;
  if (day < openDayOf(present.day)) {
    return refuse("not_yet", `Presents open from December ${PRESENTS.openFrom}. Not long now.`);
  }
  if (inventorySize(own(items.inventories, actor)) + present.count > ITEMS.inventoryMax) {
    return refuse("inventory_full", "Make room in your things first: it won't fit.");
  }
  return () => unwrap(items, present);
}

/**
 * `town_presents {to}`, which only TOWN_ACTOR sends, on December 25 and once a year: a present of
 * candy canes from the town for each of `to`, each a resident with a hearth who isn't townsfolk
 * and has no present waiting. The canes are new, like the town's Halloween candy.
 */
export function checkTownPresents(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "town_presents" }>,
): Mutation | Rejection {
  if (actor !== TOWN_ACTOR) return refuse("server_only", "Only the town leaves its presents.");
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const { year, month, date } = dateOfDay(day);
  if (month !== 12 || date !== PRESENTS.openFrom) {
    return refuse("server_only", "The town leaves its presents on December 25.");
  }
  if (items.townPresents === year) {
    return refuse("server_only", "The town left its presents this year already.");
  }
  const { to } = command;
  if (to.length === 0) return refuse("server_only", "Name at least one resident.");
  const sorted = [...new Set(to)].sort();
  if (to.length !== sorted.length || to.some((id, i) => id !== sorted[i])) {
    return refuse("server_only", "List each resident once, sorted.");
  }
  for (const id of to) {
    const r = residentById(state, id);
    if (!r || !r.hearth || isTownsfolk(state, id) || presentsFor(state, id).length > 0) {
      return refuse("server_only", `Resident ${id} isn't one the town leaves a present for.`);
    }
  }
  return () => {
    items.townPresents = year;
    return to.map((id) => {
      const present = addPresent(items, {
        from: TOWN_ACTOR,
        to: id,
        kind: "candy_cane",
        count: PRESENTS.townCanes,
        day,
      });
      return { type: "present_given", from: TOWN_ACTOR, to: id, present } as WorldEvent;
    });
  };
}

/**
 * At `new_day`, from the new year on: presents still wrapped from an earlier year open themselves,
 * oldest first, as many as fit in their recipients' things. The rest wait to be opened by hand.
 */
export function presentsNewDay(state: WorldState, day: number): Mutation | null {
  const items = state.items;
  const year = dateOfDay(day).year;
  const due = Object.values(items?.presents ?? {}).filter((p) => dateOfDay(p.day).year < year);
  if (!items || due.length === 0) return null;
  return () => {
    const events: WorldEvent[] = [];
    for (const present of due.sort((a, b) => Number(a.id.slice(8)) - Number(b.id.slice(8)))) {
      const room = ITEMS.inventoryMax - inventorySize(own(items.inventories, present.to));
      if (present.count <= room) events.push(...unwrap(items, present));
    }
    return events;
  };
}
