import {
  type BlockKind,
  type Command,
  GROUND_KINDS,
  type GroundKind,
  MAP_BLOCKS,
  MAP_GROUND,
  MAP_MARKS,
} from "@terrakin/sim";

/**
 * Reading a map back into a plan (RFC 0032). A map is a drawing of a plot, a row of text per row
 * of tiles; `mapToPlan` turns it into the four lists `build` has always taken, so the sim checks
 * and logs exactly what it would for a list plan. Pure: the plot as it stands comes in as data.
 */

/** A map as `build` takes it: `floor` absent is the ground floor, and either grid may be left out. */
export interface MapInput {
  floors: {
    floor?: number | undefined;
    blocks?: string[] | undefined;
    ground?: string[] | undefined;
  }[];
  legend?: { [digit: string]: BlockKind | undefined } | undefined;
}

/** What stands on a plot now, from its north-west corner, as `plotPlan` reads it. */
export interface PlotNow {
  blocks: readonly { x: number; y: number; floor?: number; block: BlockKind }[];
  ground: readonly { x: number; y: number; floor?: number; ground: GroundKind }[];
}

/** The four lists of a `build`, as the sim takes them. */
export type PlanLists = Pick<
  Extract<Command, { type: "build" }>,
  "blocks" | "ground" | "remove" | "lift"
>;

type Tile = { x: number; y: number; floor?: number };

/** The fixed characters in words, for a refusal. */
const BLOCK_WORDS = Object.entries(MAP_BLOCKS)
  .map(([c, kind]) => `${c} ${kind}`)
  .join(", ");
const GROUND_WORDS = Object.entries(MAP_GROUND)
  .map(([c, kind]) => `${c} ${kind}`)
  .join(", ");
const MARK_WORDS = `${MAP_MARKS.keep} to leave a tile as it is, ${MAP_MARKS.clear} to clear it`;

/** A character as a refusal may show it: one printable character, or nothing of it at all. */
const shown = (c: string) => (/^[\x21-\x7e]$/.test(c) ? `"${c}"` : "a character it can't read");

/** Characters that read as `.`: the ones only maps the server writes have. */
const KEEPS: ReadonlySet<string> = new Set([
  MAP_MARKS.keep,
  MAP_MARKS.hearth,
  MAP_MARKS.standing,
  MAP_MARKS.more,
]);

const isGroundKind = (k: unknown): k is GroundKind =>
  typeof k === "string" && (GROUND_KINDS as readonly string[]).includes(k);

/**
 * A map as a plan for a plot of `size` tiles, or why not. A letter places, `x` clears, and `.`
 * leaves a tile alone; a letter on a tile that holds something else is skipped by the sim as
 * `occupied`, unless `replace` asks to clear what differs first. Shape problems refuse the whole
 * map, naming the floor, the grid, and the tile.
 */
export function mapToPlan(
  map: MapInput,
  options: { size: number; now: PlotNow; replace?: boolean | undefined },
): { plan: PlanLists } | { problem: string } {
  const { size, now, replace = false } = options;
  const legend = map.legend ?? {};
  const at = (t: Tile) => `${t.floor ?? 0}:${t.x},${t.y}`;
  const blocksNow = new Map(now.blocks.map((b) => [at(b), b.block]));
  const groundNow = new Map(now.ground.map((g) => [at(g), g.ground]));
  const plan = {
    remove: [] as Tile[],
    lift: [] as Tile[],
    blocks: [] as (Tile & { block: BlockKind })[],
    ground: [] as (Tile & { ground: GroundKind })[],
  };
  const seen = new Set<number>();
  for (const entry of map.floors) {
    const floor = entry.floor ?? 0;
    if (seen.has(floor)) return { problem: `Floor ${floor} is in the map twice.` };
    seen.add(floor);
    for (const grid of ["blocks", "ground"] as const) {
      const rows = entry[grid];
      if (rows === undefined) continue;
      const which = `floor ${floor}'s ${grid}`;
      const have = grid === "blocks" ? "have" : "has";
      if (rows.length !== size) {
        return {
          problem: `${cap(which)} ${have} ${rows.length} rows. A plot is ${size} rows of ${size} tiles.`,
        };
      }
      for (const [y, row] of rows.entries()) {
        const chars = [...row];
        if (chars.length !== size) {
          return {
            problem: `Row ${y} of ${which} is ${chars.length} characters long. A plot is ${size} tiles wide.`,
          };
        }
        for (const [x, c] of chars.entries()) {
          const tile = { x, y, ...(floor === 0 ? {} : { floor }) };
          if (KEEPS.has(c)) continue;
          if (grid === "blocks") {
            const there = blocksNow.get(at(tile));
            if (c === MAP_MARKS.clear) {
              if (there !== undefined) plan.remove.push(tile);
              continue;
            }
            const kind = (MAP_BLOCKS as Record<string, BlockKind>)[c] ?? legend[c];
            if (!kind) {
              return {
                problem: `${cap(which)} ${have} ${shown(c)} at (${x}, ${y}), which isn't a block. Blocks: ${BLOCK_WORDS}, and digits from the map's legend; ${MARK_WORDS}.`,
              };
            }
            if (replace && there !== undefined && there !== kind) plan.remove.push(tile);
            plan.blocks.push({ ...tile, block: kind });
          } else {
            const there = groundNow.get(at(tile));
            if (c === MAP_MARKS.clear) {
              if (there !== undefined) plan.lift.push(tile);
              continue;
            }
            const kind = (MAP_GROUND as Record<string, GroundKind>)[c];
            if (!isGroundKind(kind)) {
              return {
                problem: `${cap(which)} ${have} ${shown(c)} at (${x}, ${y}), which isn't a path or flooring. Ground: ${GROUND_WORDS}; ${MARK_WORDS}.`,
              };
            }
            if (replace && there !== undefined && there !== kind) plan.lift.push(tile);
            plan.ground.push({ ...tile, ground: kind });
          }
        }
      }
    }
  }
  return {
    plan: {
      ...(plan.remove.length > 0 ? { remove: plan.remove } : {}),
      ...(plan.lift.length > 0 ? { lift: plan.lift } : {}),
      ...(plan.blocks.length > 0 ? { blocks: plan.blocks } : {}),
      ...(plan.ground.length > 0 ? { ground: plan.ground } : {}),
    },
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
