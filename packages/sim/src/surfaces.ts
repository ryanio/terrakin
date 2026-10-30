import { TRINKET_KINDS, type TrinketKind, WALL_DECOR_KINDS, type WallDecorKind } from "./catalog";
import { refuse } from "./check";
import { closed, fitsOne, holdAside, isShownFind, isShownGood, isShownThing } from "./display";
import { edgeAt } from "./edges";
import { blocksOn, groundOn, HOLDING_BLOCKS } from "./floors";
import {
  addStack,
  held,
  ITEM_ID_PATTERN,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventoryMaxOf,
  isFindKind,
} from "./items";
import { tileKey } from "./keys";
import { tileListedProblem } from "./plot-market";
import { potKey } from "./pottery";
import {
  type BlockKind,
  type Command,
  type ItemsState,
  type Rejection,
  type ResidentId,
  type Shown,
  SIDE_WORDS,
  SIDES,
  type Side,
  type WorldEvent,
  type WorldState,
} from "./types";
import { blocksWalkers, canBuildOn, inBounds, plotAtTile } from "./world";

/**
 * Roomier homes (RFC 0050): a small thing on a surface, and a thing hung on a wall. Each is one
 * per spot, out of its holder's things until it's taken off, and goes back to whoever put it
 * there, held aside when their things are full, as a display does. Nothing here runs before
 * `open_items`, and `items.tops` and `items.hung` are absent until the first, so older logs replay
 * as they did. Nothing on a surface or a wall ever blocks or opens a walk.
 *
 * `apply.ts` runs the checks every block gets first (in the world, within reach, a plot you can
 * build on, not listed, the floor), then hands on here.
 */

/** Blocks that hold one small thing on top. */
export const SURFACE_BLOCKS = [
  "table",
  "bookshelf",
  "barrel",
  "kitchen",
  "desk",
  "side_table",
  "dresser",
  "coffee_table",
] as const satisfies readonly BlockKind[];

export const isSurface = (block: BlockKind | undefined): boolean =>
  block !== undefined && (SURFACE_BLOCKS as readonly string[]).includes(block);

/** Windows hold a floor up but nothing hung: a picture can't hang on glass. */
const WINDOWS: readonly BlockKind[] = ["glass", "sea_glass_pane"];

/** Whether a thing hangs on `block`: the solid walls of `HOLDING_BLOCKS`. Hedges, doors and windows hold nothing. */
export const isHangingWall = (block: BlockKind | undefined): boolean =>
  block !== undefined && HOLDING_BLOCKS.includes(block) && !WINDOWS.includes(block);

export const isSide = (side: unknown): side is Side =>
  typeof side === "string" && (SIDES as readonly string[]).includes(side);

/** One step toward each side. */
export const SIDE_STEP: Readonly<Record<Side, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/** Where `items.tops` keeps the small thing on (x, y) of `floor`: the same key as a pot's. */
export const topKey = (x: number, y: number, floor: number): string => potKey(x, y, floor);

/** Where `items.hung` keeps what hangs on the wall on `side` of (x, y) of `floor`. */
export const faceKey = (x: number, y: number, side: Side, floor: number): string =>
  floor === 0 ? `${tileKey(x, y)},${side}` : `${floor}:${tileKey(x, y)},${side}`;

/** The tile, side and floor a face key names. */
export function parseFaceKey(key: string): { x: number; y: number; side: Side; floor: number } {
  const [floorPart, rest] = key.includes(":") ? key.split(":") : ["0", key];
  const [x, y, side] = (rest as string).split(",");
  return { x: Number(x), y: Number(y), side: side as Side, floor: Number(floorPart) };
}

/** The tile, floor and key a top key names. */
export function parseTopKey(key: string): { x: number; y: number; floor: number } {
  const [floorPart, rest] = key.includes(":") ? key.split(":") : ["0", key];
  const [x, y] = (rest as string).split(",");
  return { x: Number(x), y: Number(y), floor: Number(floorPart) };
}

/** What stands on the surface at (x, y) of `floor`, if anything. */
export const topAt = (state: WorldState, x: number, y: number, floor = 0): Shown | undefined =>
  state.items?.tops?.[topKey(x, y, floor)];

/** What hangs on the wall on `side` of (x, y) of `floor`, if anything. */
export const hungAt = (
  state: WorldState,
  x: number,
  y: number,
  side: Side,
  floor = 0,
): Shown | undefined => state.items?.hung?.[faceKey(x, y, side, floor)];

/**
 * Who put up what a `take_off` or `unhang` names, if anything is there. Read before the where-check,
 * so whoever put it there can take it back once they can't build on the plot.
 */
export function shownBy(
  state: WorldState,
  command: Extract<Command, { type: "take_off" | "unhang" }>,
): ResidentId | undefined {
  const floor =
    command.floor === undefined || (Number.isInteger(command.floor) && command.floor >= 0)
      ? (command.floor ?? 0)
      : undefined;
  if (floor === undefined) return undefined;
  if (command.type === "take_off")
    return state.items?.tops?.[topKey(command.x, command.y, floor)]?.by;
  if (!isSide(command.side)) return undefined;
  return state.items?.hung?.[faceKey(command.x, command.y, command.side, floor)]?.by;
}

/** Whether anything hangs on a wall seen from (x, y) of `floor`, on any side. */
export const hungFrom = (state: WorldState, x: number, y: number, floor = 0): boolean =>
  SIDES.some((side) => hungAt(state, x, y, side, floor) !== undefined);

/** The words for what's shown, for a refusal. */
function shownWords(shown: Shown): string {
  if (isShownThing(shown)) return `A ${shown.thing.replace(/_/g, " ")}`;
  if (isShownFind(shown)) return `A ${shown.find.replace(/_/g, " ")}`;
  return "Something";
}

/** Why the surface at (x, y) can't be taken up: something stands on it. */
export function topRemoveProblem(
  state: WorldState,
  x: number,
  y: number,
  floor = 0,
): Rejection | null {
  const top = topAt(state, x, y, floor);
  if (!top) return null;
  const words =
    floor === 0 ? `take_off at x ${x}, y ${y}` : `take_off at x ${x}, y ${y}, floor ${floor}`;
  return refuse(
    "tile_occupied",
    `${shownWords(top)} stands on that. Take it off first (${words}).`,
  );
}

/** Why a block can't go on (x, y) of `floor`: something hangs on a wall seen from there. */
export function hungPlaceProblem(
  state: WorldState,
  x: number,
  y: number,
  floor = 0,
): Rejection | null {
  if (!hungFrom(state, x, y, floor)) return null;
  return refuse(
    "tile_occupied",
    "Something hangs on a wall facing that tile. Take it down first (unhang), or put the block elsewhere.",
  );
}

/**
 * What a wall coming down at (x, y) of `floor` takes with it: each thing hung on any of its faces
 * goes back to whoever hung it, held aside when they have no room. Part of a commit, never a
 * refusal, so a plan or a town rebuild that moves a wall never fails on a picture.
 */
export function releaseHungOn(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  actor: ResidentId,
): WorldEvent[] {
  const faces = SIDES.map((side) => {
    const [dx, dy] = SIDE_STEP[side];
    return { x: x - dx, y: y - dy, side };
  });
  return releaseFaces(state, faces, floor, actor);
}

/**
 * What a wall between tiles coming down takes with it (RFC 0050): the thing hung on each of its
 * two faces, seen from the tiles on either side of its line, as `releaseHungOn` does for a block.
 */
export function releaseHungOnEdge(
  state: WorldState,
  x: number,
  y: number,
  side: "n" | "w",
  floor: number,
  actor: ResidentId,
): WorldEvent[] {
  const faces: { x: number; y: number; side: Side }[] =
    side === "n"
      ? [
          { x, y: y - 1, side: "s" },
          { x, y, side: "n" },
        ]
      : [
          { x: x - 1, y, side: "e" },
          { x, y, side: "w" },
        ];
  return releaseFaces(state, faces, floor, actor);
}

/** Each face's hung thing back to whoever hung it, held aside when they're full. */
function releaseFaces(
  state: WorldState,
  faces: readonly { x: number; y: number; side: Side }[],
  floor: number,
  actor: ResidentId,
): WorldEvent[] {
  const items = state.items;
  if (!items?.hung) return [];
  const events: WorldEvent[] = [];
  for (const { x, y, side } of faces) {
    const key = faceKey(x, y, side, floor);
    const shown = items.hung[key];
    if (!shown) continue;
    delete items.hung[key];
    events.push({ type: "unhung", x, y, side, ...floorField(floor), by: actor });
    events.push(...giveBack(state, items, shown));
  }
  if (Object.keys(items.hung).length === 0) delete items.hung;
  return events;
}

const floorField = (floor: number) => (floor === 0 ? {} : { floor });

/** What `item` names, taken from `actor`'s things, or why not. */
type Taken = { shown: Shown; change: () => WorldEvent[] };

function takeFrom(
  state: WorldState,
  items: ItemsState,
  actor: ResidentId,
  item: unknown,
  place: "surface" | "wall",
): Taken | Rejection {
  const day = state.day as number;
  const mine = items.inventories[actor];
  const wrong = place === "surface" ? WALL_DECOR_KINDS : TRINKET_KINDS;
  if (typeof item === "string" && (wrong as readonly string[]).includes(item)) {
    return place === "surface"
      ? refuse("unknown_item", "That hangs on a wall. Use hang with a side.")
      : refuse("unknown_item", "That stands on a table or a shelf. Use put_on.");
  }
  const right = place === "surface" ? TRINKET_KINDS : WALL_DECOR_KINDS;
  const kind =
    typeof item === "string" && (right as readonly string[]).includes(item)
      ? (item as TrinketKind | WallDecorKind)
      : undefined;
  if (kind !== undefined || isFindKind(item)) {
    const stack = (kind ?? item) as TrinketKind | WallDecorKind;
    if (held(mine, stack) < 1) return refuse("not_enough_items", "You don't have that.");
    const shown: Shown =
      kind !== undefined
        ? { thing: kind, by: actor, day }
        : { find: item as Extract<Shown, { find: unknown }>["find"], by: actor, day };
    return {
      shown,
      change: () => [
        inventoryEvent(actor, "put_up", [addStack(inventory(items, actor), stack, -1)]),
      ],
    };
  }
  if (typeof item !== "string" || !ITEM_ID_PATTERN.test(item)) {
    return refuse(
      "unknown_item",
      place === "surface"
        ? "Put on a small thing by its kind (like candle), a find by its kind (like geode), or a made thing by its id (i_...)."
        : "Hang a wall thing by its kind (like wall_clock), a find by its kind, or a made thing or a piece by its id (i_...).",
    );
  }
  const good = mine?.goods.find((g) => g.id === item);
  if (!good) return refuse("not_enough_items", "You don't have that.");
  return {
    shown: { good, by: actor, day },
    change: () => {
      const inv = inventory(items, actor);
      inv.goods = inv.goods.filter((g) => g.id !== item);
      return [inventoryEvent(actor, "put_up", [], { lost: [item] })];
    },
  };
}

/** The fields an event carries for what's shown: the made thing, the find, or the kind. */
function shownFields(shown: Shown) {
  if (isShownGood(shown)) return { good: { ...shown.good } };
  if (isShownFind(shown)) return { find: shown.find };
  return { thing: shown.thing };
}

/** Back to whoever put it there, or held aside for them when their things are full. */
function giveBack(state: WorldState, items: ItemsState, shown: Shown): WorldEvent[] {
  const { by } = shown;
  if (!fitsOne(state, items, by)) {
    holdAside(items, shown);
    return [];
  }
  const theirs = inventory(items, by);
  if (isShownGood(shown)) {
    theirs.goods.push(shown.good);
    return [inventoryEvent(by, "taken_off", [], { gained: [shown.good] })];
  }
  const kind = isShownFind(shown) ? shown.find : shown.thing;
  return [inventoryEvent(by, "taken_off", [addStack(theirs, kind, 1)])];
}

/** Whoever put it up needs room when it's them taking it off; anyone else's waits for them. */
function roomProblem(
  state: WorldState,
  items: ItemsState,
  actor: ResidentId,
  shown: Shown,
): Rejection | null {
  if (shown.by !== actor || fitsOne(state, items, actor)) return null;
  return refuse(
    "inventory_full",
    `You can hold ${inventoryMaxOf(state)} things, and taking this off needs room for one more.`,
  );
}

/** `put_on {x, y, floor?, item}`, after `apply`'s checks for where. */
export function checkPutOn(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "put_on" }>,
  floor: number,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { x, y } = command;
  if (!isSurface(blocksOn(state, floor)[tileKey(x, y)])) {
    return refuse(
      "not_a_surface",
      "Small things go on a table, a bookshelf, a barrel, a kitchen, a desk, a side table, a dresser or a coffee table. Place one there first.",
    );
  }
  const key = topKey(x, y, floor);
  if (items.tops?.[key]) {
    return refuse("tile_occupied", "Something already stands on that. Take it off first.");
  }
  const taken = takeFrom(state, items, actor, command.item, "surface");
  if ("code" in taken) return taken;
  return () => {
    const changed = taken.change();
    items.tops = { ...items.tops, [key]: taken.shown };
    return [
      ...changed,
      { type: "put_on", x, y, ...floorField(floor), ...shownFields(taken.shown), by: actor },
    ];
  };
}

/** `take_off {x, y, floor?}`, after `apply`'s checks for where. */
export function checkTakeOff(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "take_off" }>,
  floor: number,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { x, y } = command;
  const key = topKey(x, y, floor);
  const shown = items.tops?.[key];
  if (!shown) return refuse("nothing_displayed", "Nothing stands on that.");
  const full = roomProblem(state, items, actor, shown);
  if (full) return full;
  return () => {
    const tops = items.tops as Record<string, Shown>;
    delete tops[key];
    if (Object.keys(tops).length === 0) delete items.tops;
    return [
      { type: "taken_off", x, y, ...floorField(floor), by: actor },
      ...giveBack(state, items, shown),
    ];
  };
}

/**
 * Why nothing can hang on the wall on `side` of (x, y) of `floor`, or null: the tile is one you can
 * stand on, and a solid wall on that side is on a plot `actor` can build on.
 */
function faceProblem(
  state: WorldState,
  actor: ResidentId,
  x: number,
  y: number,
  side: unknown,
  floor: number,
): Rejection | null {
  if (!isSide(side))
    return refuse("no_wall", "side is n, e, s or w: the side of the tile the wall is on.");
  const key = tileKey(x, y);
  if (blocksWalkers(blocksOn(state, floor)[key])) {
    return refuse(
      "tile_occupied",
      "Hang a thing from a tile you could stand on, facing the wall. That tile holds a block.",
    );
  }
  if (floor > 0 && groundOn(state, floor)[key] === undefined) {
    return refuse("no_floor", "There's no flooring to stand on there.");
  }
  // A wall between tiles on that side (RFC 0050) holds a thing as a wall block beside it does. The
  // where-check already put the tile on a plot `actor` builds on, and an edge stands only between
  // two such tiles.
  if (isHangingWall(edgeAt(state, x, y, side, floor))) return null;
  const [dx, dy] = SIDE_STEP[side];
  const wx = x + dx;
  const wy = y + dy;
  const wall = inBounds(state.config, wx, wy) ? blocksOn(state, floor)[tileKey(wx, wy)] : undefined;
  if (!isHangingWall(wall)) {
    return refuse(
      "no_wall",
      `There's no wall on the ${SIDE_WORDS[side]} side of x ${x}, y ${y} to hang it on. Things hang on wood, stone and made walls; windows, doors and hedges hold nothing.`,
    );
  }
  if (!canBuildOn(plotAtTile(state, wx, wy), actor)) {
    return refuse("not_your_plot", "That wall is on a plot you can't build on.");
  }
  // A plot for sale is frozen, the wall's as much as the tile's (RFC 0039).
  return tileListedProblem(state, wx, wy);
}

/** `hang {x, y, side, floor?, item}`, after `apply`'s checks for where. */
export function checkHang(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "hang" }>,
  floor: number,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { x, y, side } = command;
  const wrong = faceProblem(state, actor, x, y, side, floor);
  if (wrong) return wrong;
  const key = faceKey(x, y, side, floor);
  if (items.hung?.[key]) {
    return refuse("tile_occupied", "Something already hangs there. Take it down first.");
  }
  const taken = takeFrom(state, items, actor, command.item, "wall");
  if ("code" in taken) return taken;
  return () => {
    const changed = taken.change();
    items.hung = { ...items.hung, [key]: taken.shown };
    return [
      ...changed,
      { type: "hung", x, y, side, ...floorField(floor), ...shownFields(taken.shown), by: actor },
    ];
  };
}

/** `unhang {x, y, side, floor?}`, after `apply`'s checks for where. */
export function checkUnhang(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "unhang" }>,
  floor: number,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { x, y, side } = command;
  if (!isSide(side))
    return refuse("no_wall", "side is n, e, s or w: the side of the tile the wall is on.");
  const key = faceKey(x, y, side, floor);
  const shown = items.hung?.[key];
  if (!shown) return refuse("nothing_displayed", "Nothing hangs there.");
  const full = roomProblem(state, items, actor, shown);
  if (full) return full;
  return () => {
    const hung = items.hung as Record<string, Shown>;
    delete hung[key];
    if (Object.keys(hung).length === 0) delete items.hung;
    return [
      { type: "unhung", x, y, side, ...floorField(floor), by: actor },
      ...giveBack(state, items, shown),
    ];
  };
}

/** Everything on surfaces, by tile and floor, north to south then west to east. */
export function topsOf(state: WorldState): { x: number; y: number; floor: number; shown: Shown }[] {
  return Object.entries(state.items?.tops ?? {})
    .map(([key, shown]) => ({ ...parseTopKey(key), shown }))
    .sort((a, b) => a.floor - b.floor || a.y - b.y || a.x - b.x);
}

/** Everything hung on walls, by tile, side and floor, in the same order. */
export function hungOf(
  state: WorldState,
): { x: number; y: number; side: Side; floor: number; shown: Shown }[] {
  return Object.entries(state.items?.hung ?? {})
    .map(([key, shown]) => ({ ...parseFaceKey(key), shown }))
    .sort(
      (a, b) =>
        a.floor - b.floor ||
        a.y - b.y ||
        a.x - b.x ||
        SIDES.indexOf(a.side) - SIDES.indexOf(b.side),
    );
}

/** Whether `id` put anything on a surface or a wall, for merging records. */
export const hasShownOnHomes = (state: WorldState, id: ResidentId): boolean =>
  [...Object.values(state.items?.tops ?? {}), ...Object.values(state.items?.hung ?? {})].some(
    (s) => s.by === id,
  );
