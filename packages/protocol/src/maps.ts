import {
  type BlockKind,
  type Command,
  EDGE_KINDS,
  GROUND_KINDS,
  type GroundKind,
  isEdgeKind,
  MAP_BLOCKS,
  MAP_EDGE_MARKS,
  MAP_GROUND,
  MAP_MARKS,
  type PastPlain,
  type Side,
} from "@terrakin/sim";

/**
 * Reading a map back into a plan (RFC 0032). A map is a drawing of a plot, a row of text per row
 * of tiles; `mapToPlan` turns it into the lists `build` takes, so the sim checks and logs exactly
 * what it would for a list plan. Pure: the plot as it stands comes in as data.
 */

/** A map as `build` takes it: `floor` absent is the ground floor, and any grid may be left out. */
export interface MapInput {
  floors: {
    floor?: number | undefined;
    blocks?: string[] | undefined;
    ground?: string[] | undefined;
    /** The lines between tiles (RFC 0050): two characters per tile plus one, each way. */
    edges?: string[] | undefined;
  }[];
  legend?: { [digit: string]: BlockKind | undefined } | undefined;
  /** Which legend digits are a graded made material (RFC 0051). A digit not here is plain. */
  grades?: { [digit: string]: PastPlain | undefined } | undefined;
}

/** What stands on a plot now, from its north-west corner, as `plotPlan` reads it. */
export interface PlotNow {
  blocks: readonly {
    x: number;
    y: number;
    floor?: number;
    block: BlockKind;
    grade?: PastPlain;
  }[];
  ground: readonly { x: number; y: number; floor?: number; ground: GroundKind }[];
  edges?: readonly {
    x: number;
    y: number;
    floor?: number;
    side: Side;
    block: BlockKind;
    grade?: PastPlain;
  }[];
}

/** The lists of a `build`, as the sim takes them. */
export type PlanLists = Pick<
  Extract<Command, { type: "build" }>,
  "blocks" | "ground" | "remove" | "lift" | "edges" | "removeEdges"
>;

type Line = { x: number; y: number; floor?: number; side: Side };

type Tile = { x: number; y: number; floor?: number };

/** The fixed characters in words, for a refusal. */
const BLOCK_WORDS = Object.entries(MAP_BLOCKS)
  .map(([c, kind]) => `${c} ${kind}`)
  .join(", ");
const GROUND_WORDS = Object.entries(MAP_GROUND)
  .map(([c, kind]) => `${c} ${kind}`)
  .join(", ");
const MARK_WORDS = `${MAP_MARKS.keep} to leave a tile as it is, ${MAP_MARKS.clear} to clear it`;
/** The letters a line takes, in words: the walls and windows of `MAP_BLOCKS`, and `D` for a door. */
const EDGE_WORDS = [
  ...Object.entries(MAP_BLOCKS)
    .filter(([, kind]) => kind !== "door" && isEdgeKind(kind))
    .map(([c, kind]) => `${c} ${kind}`),
  `${MAP_EDGE_MARKS.door} door`,
].join(", ");

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
 * A floor's `edges` grid (RFC 0050) as lines, or why not. The grid is `2 * size + 1` rows of as
 * many characters, or fewer when a row leaves off the spaces at its end. Even rows hold the lines along the north side of each row of tiles at odd
 * columns, and odd rows the lines along the west side of each tile at even columns; the rest are
 * corners and tiles, drawn for orientation and never read. On a line, a letter or a legend digit
 * is a wall of that kind, `D` a door, `x` takes down what's there, and a space or `.` leaves it.
 * The plot's south and east borders come back as `s` and `e` lines of its last row and column.
 */
function readEdges(
  rows: readonly string[],
  floor: number,
  size: number,
  legend: { [digit: string]: BlockKind | undefined },
): { problem: string } | { lines: (Line & { char: string })[] } {
  const noLegend = (char: string, r: number, c: number) =>
    `${cap(`floor ${floor}'s edges`)} have ${shown(char)} on a line at row ${r}, column ${c}, a digit with no legend to say what wall it is. Digits mean what a legend beside the floors says: send the map's legend with it, or send the plot's own map back and its legend is the one the plot's read gave.`;
  const span = 2 * size + 1;
  const which = `floor ${floor}'s edges`;
  if (rows.length !== span) {
    return {
      problem: `${cap(which)} have ${rows.length} rows. A plot of ${size} tiles has ${span} rows of ${span} characters there: two per tile and one more.`,
    };
  }
  const lines: (Line & { char: string })[] = [];
  for (const [r, row] of rows.entries()) {
    const chars = [...row];
    if (chars.length > span) {
      return {
        problem: `Row ${r} of ${which} is ${chars.length} characters long. A plot of ${size} tiles is ${span} wide there.`,
      };
    }
    // A row may stop at its last wall, since text often loses the spaces at the end of a line.
    for (const [c, char] of chars.entries()) {
      // A line sits where exactly one of its row and column is odd.
      if (r % 2 === c % 2) continue;
      if (char === MAP_EDGE_MARKS.none || char === MAP_MARKS.keep) continue;
      if (char !== MAP_EDGE_MARKS.door && char !== MAP_MARKS.clear) {
        const kind = (MAP_BLOCKS as Record<string, BlockKind>)[char] ?? legend[char];
        if (kind === undefined && /^[0-9]$/.test(char)) {
          return { problem: noLegend(char, r, c) };
        }
        if (kind === undefined || kind === "door" || !isEdgeKind(kind)) {
          return {
            problem: `${cap(which)} have ${shown(char)} on a line at row ${r}, column ${c}, which can't stand between tiles. Lines: ${EDGE_WORDS}, digits from the map's legend for ${EDGE_KINDS.filter((k) => !Object.values(MAP_BLOCKS).includes(k as never)).join(", ")}; a space or ${MAP_MARKS.keep} leaves a line as it is, ${MAP_MARKS.clear} takes its wall down.`,
          };
        }
      }
      const at = floor === 0 ? {} : { floor };
      const x = Math.floor(c / 2);
      const y = Math.floor(r / 2);
      // Even rows: the north line of tile (x, y), or the south line of the last row.
      if (r % 2 === 0) {
        lines.push(
          y < size ? { x, y, ...at, side: "n", char } : { x, y: size - 1, ...at, side: "s", char },
        );
      } else {
        lines.push(
          x < size ? { x, y, ...at, side: "w", char } : { x: size - 1, y, ...at, side: "e", char },
        );
      }
    }
  }
  return { lines };
}

/**
 * The walls between tiles a map's `edges` grids draw (RFC 0050), every floor, each keyed by the
 * `n` or `w` line of its tile as the world's snapshot lists them, so a picture of a map draws them
 * as it draws a plot's. A grid that can't be read draws none; `x` and a space draw nothing.
 */
export function mapEdges(
  map: Pick<MapInput, "floors" | "legend">,
  size: number,
): { x: number; y: number; floor: number; side: "n" | "w"; block: BlockKind }[] {
  const out: { x: number; y: number; floor: number; side: "n" | "w"; block: BlockKind }[] = [];
  for (const entry of map.floors) {
    if (!entry.edges) continue;
    const floor = entry.floor ?? 0;
    const read = readEdges(entry.edges, floor, size, map.legend ?? {});
    if ("problem" in read) continue;
    for (const line of read.lines) {
      if (line.char === MAP_MARKS.clear) continue;
      const block =
        line.char === MAP_EDGE_MARKS.door
          ? "door"
          : ((MAP_BLOCKS as Record<string, BlockKind>)[line.char] ?? map.legend?.[line.char]);
      if (!block) continue;
      const at =
        line.side === "s"
          ? { x: line.x, y: line.y + 1, side: "n" as const }
          : line.side === "e"
            ? { x: line.x + 1, y: line.y, side: "w" as const }
            : { x: line.x, y: line.y, side: line.side as "n" | "w" };
      out.push({ ...at, floor, block });
    }
  }
  return out;
}

/** A line's key, with `s` and `e` read as the next tile's `n` and `w`. */
function lineKey(l: { x: number; y: number; floor?: number | undefined; side: Side }): string {
  const [x, y, side] =
    l.side === "s"
      ? [l.x, l.y + 1, "n"]
      : l.side === "e"
        ? [l.x + 1, l.y, "w"]
        : [l.x, l.y, l.side];
  return `${l.floor ?? 0}:${x},${y},${side}`;
}

/**
 * A map as a plan for a plot of `size` tiles, or why not. A letter places, `x` clears, and `.`
 * leaves a tile alone; a letter on a tile that holds something else is skipped by the sim as
 * `occupied`, unless `replace` asks to clear what differs first. A floor's `edges` grid does the
 * same for the lines between tiles (`readEdges`). Shape problems refuse the whole map, naming the
 * floor, the grid, and the tile. A digit with no legend in the map or in the plot's own current
 * legend (`current`) refuses in words that say a legend is what it needs.
 */
export function mapToPlan(
  map: MapInput,
  options: {
    size: number;
    now: PlotNow;
    replace?: boolean | undefined;
    /**
     * The plot's own map legend and grades as its read gives them (issue #135). A map sent back
     * for the plot it was read from may leave its legend out: its digits then mean what the
     * plot's own legend says. A legend the map carries wins, digit by digit.
     */
    current?: Pick<MapInput, "legend" | "grades"> | undefined;
  },
): { plan: PlanLists } | { problem: string } {
  const { size, now, replace = false, current } = options;
  const legend: { [digit: string]: BlockKind | undefined } = { ...current?.legend };
  for (const [digit, kind] of Object.entries(map.legend ?? {})) {
    if (kind !== undefined) legend[digit] = kind;
  }
  const grades: { [digit: string]: PastPlain | undefined } = { ...current?.grades };
  for (const [digit, grade] of Object.entries(map.grades ?? {})) {
    if (grade !== undefined) grades[digit] = grade;
  }
  // A digit's grade (RFC 0051) goes on the plan entry, so the sim sees lists as it always has.
  const gradeOf = (char: string): { grade?: PastPlain } => {
    const grade = grades[char];
    return grade && legend[char] !== undefined ? { grade } : {};
  };
  const at = (t: Tile) => `${t.floor ?? 0}:${t.x},${t.y}`;
  // What stands where, as its kind and grade, so `replace` takes away a wall of another grade too.
  const unit = (s: { block: BlockKind; grade?: PastPlain | undefined }) =>
    s.grade ? `${s.block}:${s.grade}` : s.block;
  const blocksNow = new Map(now.blocks.map((b) => [at(b), unit(b)]));
  const groundNow = new Map(now.ground.map((g) => [at(g), g.ground]));
  const edgesNow = new Map((now.edges ?? []).map((e) => [lineKey(e), unit(e)]));
  const plan = {
    remove: [] as Tile[],
    lift: [] as Tile[],
    blocks: [] as (Tile & { block: BlockKind; grade?: PastPlain })[],
    ground: [] as (Tile & { ground: GroundKind })[],
    removeEdges: [] as Line[],
    edges: [] as (Line & { block: BlockKind; grade?: PastPlain })[],
  };
  const seen = new Set<number>();
  for (const entry of map.floors) {
    const floor = entry.floor ?? 0;
    if (seen.has(floor)) return { problem: `Floor ${floor} is in the map twice.` };
    seen.add(floor);
    if (entry.edges !== undefined) {
      const read = readEdges(entry.edges, floor, size, legend);
      if ("problem" in read) return read;
      for (const { char, ...line } of read.lines) {
        const there = edgesNow.get(lineKey(line));
        if (char === MAP_MARKS.clear) {
          if (there !== undefined) plan.removeEdges.push(line);
          continue;
        }
        const kind =
          char === MAP_EDGE_MARKS.door
            ? "door"
            : ((MAP_BLOCKS as Record<string, BlockKind>)[char] ?? (legend[char] as BlockKind));
        const graded = gradeOf(char);
        const wanted = unit({ block: kind, ...graded });
        if (replace && there !== undefined && there !== wanted) plan.removeEdges.push(line);
        plan.edges.push({ ...line, block: kind, ...graded });
      }
    }
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
            // A pot set down (RFC 0047) is placed by its id, never from a plan, so its digit in a
            // map the server wrote leaves the tile as it stands, like `.`, and a plot's own map can
            // always be sent back.
            if (kind === "pot") continue;
            if (!kind) {
              return {
                problem: /^[0-9]$/.test(c)
                  ? `${cap(which)} ${have} ${shown(c)} at (${x}, ${y}), a digit with no legend to say what it is. Digits mean what a legend beside the floors says: send the map's legend with it, or send the plot's own map back and its legend is the one the plot's read gave; ${MARK_WORDS}.`
                  : `${cap(which)} ${have} ${shown(c)} at (${x}, ${y}), which isn't a block. Blocks: ${BLOCK_WORDS}, and digits from the map's legend; ${MARK_WORDS}.`,
              };
            }
            const graded = gradeOf(c);
            const wanted = unit({ block: kind, ...graded });
            if (replace && there !== undefined && there !== wanted) plan.remove.push(tile);
            plan.blocks.push({ ...tile, block: kind, ...graded });
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
      ...(plan.edges.length > 0 ? { edges: plan.edges } : {}),
      ...(plan.removeEdges.length > 0 ? { removeEdges: plan.removeEdges } : {}),
    },
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
