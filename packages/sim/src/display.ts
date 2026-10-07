import { refuse } from "./check";
import {
  addStack,
  type FindKind,
  held,
  ITEM_ID_PATTERN,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  isFindKind,
  reachProblem,
} from "./items";
import { parseKey, plotKey, tileKey } from "./keys";
import { MEDIA_ID_PATTERN } from "./looks";
import type {
  BlockKind,
  Command,
  Display,
  Good,
  ItemsState,
  Rejection,
  ResidentId,
  Shown,
  ShownFind,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, inBounds, plotAtTile } from "./world";

/**
 * Showing (RFC 0005 step 3): pieces of art made from your own uploads, and made things on display
 * on a `pedestal` or a `frame`. Nothing here runs before `open_items`, and display state is absent
 * until the first `display`, so older logs replay as they did.
 *
 * A find (RFC 0021) can go on display too, by its kind: one of the stack stands there until it's
 * taken down. It has no maker and no id, so it's never admired, reported, or in a gallery, and the
 * read helpers for made things (`displaysOf`, `displayOfItem`, `heldAsideOf`, `everyGood`) leave
 * it out.
 */

/** Blocks a made thing can stand or hang on. */
export const DISPLAY_BLOCKS = ["pedestal", "frame"] as const satisfies readonly BlockKind[];
export const isDisplayBlock = (block: unknown): boolean =>
  typeof block === "string" && (DISPLAY_BLOCKS as readonly string[]).includes(block);

/** Whether what's on display is a find, not a made thing. */
export const isShownFind = (shown: Shown): shown is ShownFind => "find" in shown;

/** What's on display on a tile, a made thing or a find, if anything. */
export const displayAt = (state: WorldState, x: number, y: number): Shown | undefined =>
  state.items?.displays?.[tileKey(x, y)];

/** Every made thing on display, by tile key. Empty before the first `display`. */
export function displaysOf(state: WorldState): Record<string, Display> {
  const out: Record<string, Display> = {};
  for (const [key, shown] of Object.entries(state.items?.displays ?? {})) {
    if (!isShownFind(shown)) out[key] = shown;
  }
  return out;
}

/** Every find on display (RFC 0021), where it is, who put it up, and the day it went up. */
export function findsOnDisplay(
  state: WorldState,
): { x: number; y: number; kind: FindKind; by: ResidentId; day: number }[] {
  return Object.entries(state.items?.displays ?? {}).flatMap(([key, shown]) => {
    if (!isShownFind(shown)) return [];
    const [x, y] = parseKey(key);
    return [{ x, y, kind: shown.find, by: shown.by, day: shown.day }];
  });
}

/** Where a made thing is on display, by its id, if it is. */
export function displayOfItem(
  state: WorldState,
  item: string,
): { x: number; y: number; key: string; shown: Display } | undefined {
  for (const [key, shown] of Object.entries(displaysOf(state))) {
    if (shown.good.id !== item) continue;
    const [x, y] = parseKey(key);
    return { x, y, key, shown };
  }
  return undefined;
}

/**
 * A resident's made things taken down from display while they had no room, oldest first. They come
 * back with that resident's first input that leaves room for them.
 */
export const heldAsideOf = (state: WorldState, id: ResidentId): Display[] =>
  (state.items?.heldAside ?? []).filter((d): d is Display => d.by === id && !isShownFind(d));

/** A resident's finds taken down from display while they had no room, oldest first. */
export const findsHeldAsideOf = (state: WorldState, id: ResidentId): ShownFind[] =>
  (state.items?.heldAside ?? []).filter((d): d is ShownFind => d.by === id && isShownFind(d));

/**
 * Every made thing in the world and who has it: in someone's things, on display (whoever put it
 * up), in the market (its seller), or held aside (who it waits for).
 */
export function everyGood(state: WorldState): { good: Good; holder: ResidentId }[] {
  const items = state.items;
  if (!items) return [];
  const out: { good: Good; holder: ResidentId }[] = [];
  for (const [holder, inv] of Object.entries(items.inventories)) {
    for (const good of inv.goods) out.push({ good, holder });
  }
  for (const d of Object.values(items.displays ?? {})) {
    if (!isShownFind(d)) out.push({ good: d.good, holder: d.by });
  }
  for (const d of items.heldAside ?? []) {
    if (!isShownFind(d)) out.push({ good: d.good, holder: d.by });
  }
  for (const l of Object.values(state.market?.listings ?? {})) {
    for (const good of l.goods ?? []) out.push({ good, holder: l.seller });
  }
  return out;
}

/** A made thing by its id, wherever it is, and who has it. */
export function goodById(
  state: WorldState,
  id: string,
): { good: Good; holder: ResidentId } | undefined {
  if (typeof id !== "string" || !ITEM_ID_PATTERN.test(id)) return undefined;
  return everyGood(state).find((g) => g.good.id === id);
}

/** One piece made from an upload, wherever it is: its id, or undefined when none shows it. */
export function pieceShowingMedia(state: WorldState, mediaId: string): string | undefined {
  return everyGood(state).find((g) => g.good.kind === "piece" && g.good.media === mediaId)?.good.id;
}

const fitsOne = (items: ItemsState, id: ResidentId) =>
  inventorySize(items.inventories[id]) + 1 <= ITEMS.inventoryMax;

/** Keep a thing taken down from display for whoever put it up, until they have room. */
function holdAside(items: ItemsState, shown: Shown) {
  items.heldAside = [...(items.heldAside ?? []), shown];
}

/**
 * Bookkeeping in `prepare()`'s commit, after a resident's own input: what's held aside for them
 * comes back, oldest first, as far as their things have room, made things to their goods and finds
 * to their stacks. Nothing changes, and no event, when nothing is held for them or there's no room.
 */
export function returnHeldAside(state: WorldState, id: ResidentId): WorldEvent[] {
  const items = state.items;
  const aside = items?.heldAside;
  if (!items || !aside?.some((d) => d.by === id)) return [];
  let size = inventorySize(items.inventories[id]);
  const back: Good[] = [];
  const finds = new Map<FindKind, number>();
  const keep = aside.filter((d) => {
    if (d.by !== id || size + 1 > ITEMS.inventoryMax) return true;
    size += 1;
    if (isShownFind(d)) finds.set(d.find, (finds.get(d.find) ?? 0) + 1);
    else back.push(d.good);
    return false;
  });
  if (back.length === 0 && finds.size === 0) return [];
  if (keep.length > 0) items.heldAside = keep;
  else delete items.heldAside;
  const mine = inventory(items, id);
  mine.goods.push(...back);
  const changes = [...finds].map(([kind, n]) => addStack(mine, kind, n));
  return [inventoryEvent(id, "held", changes, { gained: back })];
}

function closed(state: WorldState): Rejection | null {
  if (!state.items || state.day === undefined) {
    return refuse("items_closed", "Growing and making haven't opened in this world yet.");
  }
  return null;
}

function reach(state: WorldState, actor: ResidentId, x: number, y: number): Rejection | null {
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  return reachProblem(state, me, { x, y });
}

/**
 * `make_piece {media, title}`: a piece of art from one of your uploads, with its title. It counts
 * as one of the things you make today and needs room in your things. The server checks the upload
 * is yours and a picture or a `.glb` model, and sets `model` for a model.
 */
export function checkMakePiece(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "make_piece" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  const { media, title, model } = command;
  if (typeof media !== "string" || !MEDIA_ID_PATTERN.test(media)) {
    return refuse("invalid_piece", "A piece shows one of your uploads: send its media id (m_...).");
  }
  if (typeof title !== "string" || title.length < 1 || title.length > ITEMS.labelMax) {
    return refuse("invalid_piece", `Give it a title, 1 to ${ITEMS.labelMax} characters.`);
  }
  if (model !== undefined && model !== true) {
    return refuse("invalid_piece", "model is true or left out.");
  }
  const crafted = items.today.crafted[actor] ?? 0;
  if (crafted >= ITEMS.craftPerDay) {
    return refuse("craft_limit", `You can make ${ITEMS.craftPerDay} things a day. Try tomorrow.`);
  }
  if (inventorySize(items.inventories[actor]) + 1 > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Give or display something first.`,
    );
  }
  const good: Good = {
    id: `i_${items.nextId}`,
    kind: "piece",
    maker: actor,
    madeDay: day,
    label: title,
    media,
    ...(model ? { model: true as const } : {}),
  };
  return () => {
    items.nextId += 1;
    items.today.crafted[actor] = crafted + 1;
    inventory(items, actor).goods.push(good);
    return [inventoryEvent(actor, "craft", [], { gained: [good] })];
  };
}

/**
 * `display {item, x, y}`: one of your made things (by id), or one of a find you hold (by its kind,
 * RFC 0021), onto an empty `pedestal` or `frame` within reach, on a plot you can build on. It
 * leaves your things and shows in the world.
 */
export function checkDisplay(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "display" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const { item, x, y } = command;
  const far = reach(state, actor, x, y);
  if (far) return far;
  if (!canBuildOn(plotAtTile(state, x, y), actor)) {
    return refuse(
      "not_your_plot",
      "You can only display on your own plot, or one shared with you.",
    );
  }
  const key = tileKey(x, y);
  if (!isDisplayBlock(state.blocks[key])) {
    return refuse(
      "no_display",
      "Display things on a pedestal or a frame. Place one with place and block pedestal.",
    );
  }
  if (items.displays?.[key]) {
    return refuse("tile_occupied", "Something is already on display there. Take it down first.");
  }
  if (isFindKind(item)) {
    if (held(items.inventories[actor], item) < 1) {
      return refuse("not_enough_items", "You don't have that.");
    }
    return () => {
      const change = addStack(inventory(items, actor), item, -1);
      items.displays ??= {};
      items.displays[key] = { find: item, by: actor, day };
      return [
        inventoryEvent(actor, "displayed", [change]),
        { type: "find_displayed", x, y, kind: item, by: actor },
      ];
    };
  }
  if (typeof item !== "string" || !ITEM_ID_PATTERN.test(item)) {
    return refuse(
      "unknown_item",
      "Display a made thing or a piece by its id (i_...), or a find by its kind (like geode). Seeds and produce stay in your things.",
    );
  }
  const good = items.inventories[actor]?.goods.find((g) => g.id === item);
  if (!good) return refuse("not_enough_items", "You don't have that.");
  return () => {
    const mine = inventory(items, actor);
    mine.goods = mine.goods.filter((g) => g.id !== item);
    items.displays ??= {};
    items.displays[key] = { good, by: actor, day };
    return [
      inventoryEvent(actor, "displayed", [], { lost: [item] }),
      { type: "displayed", x, y, good: { ...good }, by: actor },
    ];
  };
}

/**
 * `take_down {x, y}`: what's on display there goes back to whoever put it up. They can take it
 * down, and so can anyone who can build on the plot. Within reach. Whoever put it up needs room
 * when it's them; when it's someone else and they're full, it's held aside for them.
 */
export function checkTakeDown(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "take_down" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { x, y } = command;
  const far = reach(state, actor, x, y);
  if (far) return far;
  const key = tileKey(x, y);
  const shown = items.displays?.[key];
  if (!shown) return refuse("nothing_displayed", "Nothing is on display there.");
  if (shown.by !== actor && !canBuildOn(plotAtTile(state, x, y), actor)) {
    return refuse(
      "not_your_plot",
      "Only whoever put it up, or someone who can build on this plot, can take it down.",
    );
  }
  const room = fitsOne(items, shown.by);
  if (!room && shown.by === actor) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and taking this down needs room for one more.`,
    );
  }
  const { by } = shown;
  return () => {
    const displays = items.displays as Record<string, Shown>;
    delete displays[key];
    const events: WorldEvent[] = [{ type: "taken_down", x, y, by: actor }];
    // Someone else took it down and whoever put it up has no room: it waits for them, so a full
    // inventory can't pin a pedestal, or the plot it stands on.
    if (!room) {
      holdAside(items, shown);
      return events;
    }
    if (isShownFind(shown)) {
      const change = addStack(inventory(items, by), shown.find, 1);
      events.push(inventoryEvent(by, "off_display", [change]));
      return events;
    }
    const { good } = shown;
    inventory(items, by).goods.push(good);
    events.push(inventoryEvent(by, "off_display", [], { gained: [good] }));
    return events;
  };
}

/**
 * `remove_display {item, picture?}`, which only TOWN_ACTOR sends: staff took a made thing off
 * display after a report (decision 0059). It goes back to whoever put it up, or is held aside for
 * them when their things are full, so nothing is lost and nothing goes past `inventoryMax`. With
 * `picture`, the thing is a piece and its picture goes, from every piece that shows the same
 * upload, wherever each is: they keep their titles and draw as a plain canvas. A piece taken this
 * way needn't be on display; when it is, it comes down too. No coins move.
 */
export function checkRemoveDisplay(
  state: WorldState,
  command: Extract<Command, { type: "remove_display" }>,
): ItemsChecked {
  const items = state.items;
  if (!items) {
    return refuse("items_closed", "Growing and making haven't opened in this world yet.");
  }
  const { item, picture } = command;
  if (picture !== undefined && picture !== true) {
    return refuse("unknown_item", "picture is true or left out.");
  }
  if (typeof item !== "string" || !ITEM_ID_PATTERN.test(item)) {
    return refuse("unknown_item", "Name a made thing by its id (i_...).");
  }
  const on = displayOfItem(state, item);
  let media: string | undefined;
  if (picture) {
    const good = on?.shown.good ?? goodById(state, item)?.good;
    if (good?.kind !== "piece" || good.media === undefined) {
      return refuse("unknown_item", "No piece with that id shows a picture.");
    }
    media = good.media;
  } else if (!on) {
    return refuse("nothing_displayed", "That isn't on display.");
  }
  const room = on ? fitsOne(items, on.shown.by) : false;
  return () => {
    const events: WorldEvent[] = [];
    if (media !== undefined) {
      const ids: string[] = [];
      for (const { good } of everyGood(state)) {
        if (good.kind !== "piece" || good.media !== media) continue;
        delete good.media;
        delete good.model;
        ids.push(good.id);
      }
      events.push({ type: "picture_removed", items: ids });
    }
    if (!on) return events;
    const { x, y, key, shown } = on;
    const { good, by } = shown;
    delete (items.displays as Record<string, Shown>)[key];
    events.push({ type: "display_removed", x, y, item, by });
    if (!room) {
      holdAside(items, shown);
      return events;
    }
    inventory(items, by).goods.push(good);
    events.push(inventoryEvent(by, "taken_down", [], { gained: [good] }));
    return events;
  };
}

/** Whether removing the block on a tile is held up by something on display on it. */
export function displayRemoveProblem(state: WorldState, x: number, y: number): Rejection | null {
  return displayAt(state, x, y)
    ? refuse("tile_occupied", "Something is on display there. Take it down first with take_down.")
    : null;
}

/**
 * `admire {x, y}`: admire what's on display there, once a UTC day per resident per thing. Not your
 * own: not something you made or put up. No reach needed, so a gallery can be admired from a
 * profile. The count stays on the thing wherever it goes.
 */
export function checkAdmire(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "admire" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  const { x, y } = command;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(state.config, x, y)) {
    return refuse("out_of_bounds", "That's outside the world.");
  }
  const shown = items.displays?.[tileKey(x, y)];
  if (!shown) return refuse("nothing_displayed", "Nothing is on display there.");
  if (isShownFind(shown)) {
    const size = state.config.plotSize;
    const plot = `${Math.floor(x / size)}/${Math.floor(y / size)}`;
    return refuse(
      "not_eligible",
      `A find has nobody who made it to thank. If you like the plot, admire it instead: POST /v1/plots/${plot}/admire.`,
    );
  }
  const { good } = shown;
  if (good.maker === actor || shown.by === actor) {
    return refuse("not_eligible", "That's yours. Admire what other residents made.");
  }
  const today = items.today.admired?.[actor] ?? [];
  if (today.includes(good.id)) {
    return refuse("already_admired", "You admired that today. Come back tomorrow.");
  }
  const admired = (good.admired ?? 0) + 1;
  return () => {
    items.today.admired = { ...items.today.admired, [actor]: [...today, good.id] };
    good.admired = admired;
    return [{ type: "admired", x, y, item: good.id, maker: good.maker, by: actor, admired }];
  };
}

/**
 * `set_gallery {px, py, open}`: mark a plot you own or share a gallery, or stop. What's on display
 * on a gallery plot is listed on the Galleries page and its residents' profiles. It needs no items
 * open: a gallery can wait for its first piece.
 */
export function checkSetGallery(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_gallery" }>,
): ItemsChecked {
  const { px, py, open } = command;
  if (typeof open !== "boolean") return refuse("invalid_profile", "open is true or false.");
  const plot = state.plots[plotKey(px, py)];
  if (!plot) return refuse("no_plot", "Nobody has claimed that plot.");
  if (!canBuildOn(plot, actor)) {
    return refuse(
      "not_your_plot",
      "Only the plot's owner, or someone it's shared with, can do that.",
    );
  }
  if ((plot.gallery === true) === open) {
    return refuse("already_set", open ? "It's already a gallery." : "It isn't a gallery.");
  }
  return () => {
    if (open) plot.gallery = true;
    else delete plot.gallery;
    return [{ type: "gallery_set", px, py, open, by: actor }];
  };
}
