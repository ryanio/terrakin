import { blocksOn } from "./floors";
import { isFurnitureKind, isSeatKind } from "./furniture";
import { parseKey, plotKey, tileKey } from "./keys";
import { parseFaceKey, parseTopKey } from "./surfaces";
import type { BlockKind, Shown, WorldState } from "./types";

/**
 * How furnished a home is (RFC 0050, open question 5): what a plot holds on every floor, counted.
 * No rule reads it, nothing is logged, and it adds no state: it is a measure for views to show.
 *
 * A piece is a block whose catalog role is furniture, or a seat (`SEATS`, so a garden bench counts
 * too). Walls, stations, decor and the display blocks themselves are not pieces. What is on show is
 * a small thing on a surface, a thing hung on a wall, and a made thing or a find on a pedestal or in
 * a frame. Kinds counts the different kinds among all of them, pieces and things on show together.
 * Counts only: never a label, a title, or who put something there.
 */
export interface Furnishing {
  /** Pieces of furniture placed, on every floor. */
  pieces: number;
  /** Small things standing on surfaces. */
  onSurfaces: number;
  /** Things hung on walls. */
  onWalls: number;
  /** Made things and finds on pedestals and in frames. */
  onDisplay: number;
  /** How many different kinds there are among the pieces and the things on show. */
  kinds: number;
}

/** A block that counts as a piece of furniture. */
const isFurniturePiece = (block: BlockKind | undefined): boolean =>
  isFurnitureKind(block) || isSeatKind(block);

/** The kind a thing on show is: a small thing's, a find's, or a made thing's. */
function shownKind(shown: Shown): string {
  if ("thing" in shown) return shown.thing;
  if ("find" in shown) return shown.find;
  return shown.good.kind;
}

interface Tally {
  pieces: number;
  onSurfaces: number;
  onWalls: number;
  onDisplay: number;
  kinds: Set<string>;
}

const newTally = (): Tally => ({
  pieces: 0,
  onSurfaces: 0,
  onWalls: 0,
  onDisplay: 0,
  kinds: new Set(),
});

const done = (t: Tally): Furnishing => ({
  pieces: t.pieces,
  onSurfaces: t.onSurfaces,
  onWalls: t.onWalls,
  onDisplay: t.onDisplay,
  kinds: t.kinds.size,
});

/** Every floor a home could have something on: the ground floor and each one some plot added. */
const floorsOf = (state: WorldState): number[] => [
  0,
  ...Object.keys(state.floors ?? {}).map(Number),
];

/**
 * Add the things on show to the tally `tallyAt` gives for the tile each is seen from: on surfaces,
 * on walls (the tile a hung thing is seen from), and on display.
 */
function addShown(state: WorldState, tallyAt: (x: number, y: number) => Tally | undefined) {
  for (const [key, shown] of Object.entries(state.items?.tops ?? {})) {
    const { x, y } = parseTopKey(key);
    const t = tallyAt(x, y);
    if (!t) continue;
    t.onSurfaces++;
    t.kinds.add(shownKind(shown));
  }
  for (const [key, shown] of Object.entries(state.items?.hung ?? {})) {
    const { x, y } = parseFaceKey(key);
    const t = tallyAt(x, y);
    if (!t) continue;
    t.onWalls++;
    t.kinds.add(shownKind(shown));
  }
  for (const [key, shown] of Object.entries(state.items?.displays ?? {})) {
    const [x, y] = parseKey(key);
    const t = tallyAt(x, y);
    if (!t) continue;
    t.onDisplay++;
    t.kinds.add(shownKind(shown));
  }
}

/** How furnished plot (px, py) is, on every floor. All zeros for a bare or unclaimed plot. */
export function furnishing(state: WorldState, px: number, py: number): Furnishing {
  const size = state.config.plotSize;
  const t = newTally();
  for (const floor of floorsOf(state)) {
    const blocks = blocksOn(state, floor);
    for (let y = py * size; y < (py + 1) * size; y++) {
      for (let x = px * size; x < (px + 1) * size; x++) {
        const block = blocks[tileKey(x, y)];
        if (!isFurniturePiece(block)) continue;
        t.pieces++;
        t.kinds.add(block as BlockKind);
      }
    }
  }
  addShown(state, (x, y) =>
    Math.floor(x / size) === px && Math.floor(y / size) === py ? t : undefined,
  );
  return done(t);
}

/**
 * How furnished every plot with anything to count is, by `plotKey`, in one pass over the world.
 * A plot with nothing is absent.
 */
export function furnishings(state: WorldState): Map<string, Furnishing> {
  const size = state.config.plotSize;
  const tallies = new Map<string, Tally>();
  const tallyAt = (x: number, y: number): Tally => {
    const key = plotKey(Math.floor(x / size), Math.floor(y / size));
    let t = tallies.get(key);
    if (!t) {
      t = newTally();
      tallies.set(key, t);
    }
    return t;
  };
  for (const floor of floorsOf(state)) {
    for (const [key, block] of Object.entries(blocksOn(state, floor))) {
      if (!isFurniturePiece(block)) continue;
      const [x, y] = parseKey(key);
      const t = tallyAt(x, y);
      t.pieces++;
      t.kinds.add(block);
    }
  }
  addShown(state, tallyAt);
  return new Map([...tallies].map(([key, t]) => [key, done(t)]));
}
