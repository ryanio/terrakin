import { refuse } from "./check";
import { ITEMS, type ItemsChecked, inventory, inventoryEvent, inventorySize } from "./items";
import { tileKey } from "./keys";
import { MEDIA_ID_PATTERN } from "./looks";
import type {
  BlockKind,
  Command,
  Display,
  Good,
  ItemsState,
  Rejection,
  ResidentId,
  WorldState,
} from "./types";
import { canBuildOn, chebyshev, inBounds, plotAtTile } from "./world";

/**
 * Showing (RFC 0005 step 3): pieces of art made from your own uploads, and made things on display
 * on a `pedestal` or a `frame`. Nothing here runs before `open_items`, and display state is absent
 * until the first `display`, so older logs replay as they did.
 */

/** Blocks a made thing can stand or hang on. */
export const DISPLAY_BLOCKS = ["pedestal", "frame"] as const satisfies readonly BlockKind[];
export const isDisplayBlock = (block: unknown): boolean =>
  typeof block === "string" && (DISPLAY_BLOCKS as readonly string[]).includes(block);

/** A made thing's id, as `display` takes it. */
const MADE_ID = /^i_[1-9][0-9]*$/;

/** The made thing on display on a tile, if any. */
export const displayAt = (state: WorldState, x: number, y: number): Display | undefined =>
  state.items?.displays?.[tileKey(x, y)];

/** Everything on display, by tile key. Empty before the first `display`. */
export const displaysOf = (state: WorldState): Record<string, Display> =>
  state.items?.displays ?? {};

function closed(state: WorldState): Rejection | null {
  if (!state.items || state.day === undefined) {
    return refuse("items_closed", "Growing and making haven't opened in this world yet.");
  }
  return null;
}

function reach(state: WorldState, actor: ResidentId, x: number, y: number): Rejection | null {
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(state.config, x, y)) {
    return refuse("out_of_bounds", "That's outside the world.");
  }
  if (chebyshev(me, { x, y }) > state.config.reach) {
    return refuse(
      "out_of_reach",
      `That's more than ${state.config.reach} tiles away. Walk closer first.`,
    );
  }
  return null;
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
 * `display {item, x, y}`: one of your made things (by id) onto an empty `pedestal` or `frame`
 * within reach, on a plot you can build on. It leaves your things and shows in the world.
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
  if (typeof item !== "string" || !MADE_ID.test(item)) {
    return refuse(
      "unknown_item",
      "Display a made thing or a piece by its id (i_...). Seeds and produce stay in your things.",
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
 * `take_down {x, y}`: what's on display there goes back to whoever put it up, if they have room.
 * They can take it down, and so can anyone who can build on the plot. Within reach.
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
  if (inventorySize(items.inventories[shown.by]) + 1 > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      shown.by === actor
        ? `You can hold ${ITEMS.inventoryMax} things, and taking this down needs room for one more.`
        : "Whoever put it up has no room for it right now.",
    );
  }
  const { good, by } = shown;
  return () => {
    const displays = items.displays as Record<string, Display>;
    delete displays[key];
    inventory(items, by).goods.push(good);
    return [
      { type: "taken_down", x, y, by: actor },
      inventoryEvent(by, "off_display", [], { gained: [good] }),
    ];
  };
}

/** Whether removing the block on a tile is held up by something on display on it. */
export function displayRemoveProblem(state: WorldState, x: number, y: number): Rejection | null {
  return displayAt(state, x, y)
    ? refuse("tile_occupied", "Something is on display there. Take it down first with take_down.")
    : null;
}
