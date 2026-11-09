import {
  apply,
  type BlockKind,
  blockNeeds,
  blocksOn,
  type Command,
  cloneWorld,
  designNotes,
  edgeAt,
  edgeKey,
  FLOORS,
  type Grade,
  gradeAt,
  gradeField,
  groundOn,
  HOLDING_BLOCKS,
  isEdgeKind,
  isWay,
  type PlanEdge,
  type PlanTile,
  prepare,
  type Side,
  TOWN_ACTOR,
  tileKey,
  type WorldState,
} from "@terrakin/sim";

/** Whether a block is a wall: a wall, a window, a hedge, a made material, or a door. */
const isWall = (block: BlockKind | undefined): block is BlockKind => isEdgeKind(block);

/** The window kinds, which stay where they stood but never stand for the home's walls. */
const WINDOWS: readonly BlockKind[] = ["glass", "sea_glass_pane"];

/** A plain wall: not a door and not a window. */
const plain = (kind: BlockKind) => kind !== "door" && !WINDOWS.includes(kind);

type XY = [number, number];

const SIDES: readonly { side: Side; dx: number; dy: number }[] = [
  { side: "n", dx: 0, dy: -1 },
  { side: "e", dx: 1, dy: 0 },
  { side: "s", dx: 0, dy: 1 },
  { side: "w", dx: -1, dy: 0 },
];

/** The side of a tile its neighbour one step (dx, dy) away is on. */
const sideTo = (dx: number, dy: number): Side => (dx > 0 ? "e" : dx < 0 ? "w" : dy > 0 ? "s" : "n");

/** The two directions a run of wall can go: along a row, and down a column. */
const RUNS: readonly XY[] = [
  [1, 0],
  [0, 1],
];

const CORNERS: readonly XY[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const xy = (key: string) => key.split(",").map(Number) as XY;
const at = (x: number, y: number) => `${x},${y}`;
const byRow = (a: string, b: string) => {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  return ay - by || ax - bx;
};

/** A wall that stood on a tile: its kind, and its grade (RFC 0051). */
interface Wall {
  block: BlockKind;
  grade: Grade;
}

/** One floor's part of the plan: the wall blocks it takes up and the lines it puts up. */
interface FloorPart {
  /** Every wall block on this floor, each of which comes up. */
  walls: Map<string, BlockKind>;
  edges: PlanEdge[];
  /** For each line, the floor and tile of the wall it stands for, or empty for none in particular. */
  from: string[];
}

/**
 * The plan that turns every wall block on plot (px, py) into walls between tiles (RFC 0050), as
 * the town's `town_slim` logs it: the blocks it takes up and the lines it walls, in plot
 * coordinates, on the ground floor and on every floor above it. Pure, so replay never runs it; the
 * sim checks what it logs as the owner's own build.
 *
 * Each floor's rooms come first (`slimFloor`): the wall blocks round them come up and the lines
 * round each room take their place. Every wall block left after that stands on its own, in a yard
 * wall, a hedge, or a post, and comes up for a line of its own (`looseFloor`), or for none when a
 * wall already stands where its line would go or no line can stand there. A wall block that gets
 * no line goes back to the owner's things, as a removal does.
 *
 * The ground floor's lines go up before any block comes out, so flooring upstairs stays held. A
 * block upstairs with no flooring under it stands on the wall below it, so when that wall comes up
 * it comes down too, with whatever stands on it the same way, and goes back to the builder's things.
 */
export function slimPlan(
  state: WorldState,
  px: number,
  py: number,
): { remove: PlanTile[]; edges: PlanEdge[] } | { problem: string } {
  const S = state.config.plotSize;
  const world = (x: number, y: number) => tileKey(px * S + x, py * S + y);
  const floors = Array.from({ length: FLOORS.max + 1 }, (_, floor) => {
    const rooms = slimFloor(state, px, py, floor);
    const loose = looseFloor(state, px, py, floor, rooms);
    return {
      walls: new Map([...rooms.walls, ...loose.walls]),
      edges: [...rooms.edges, ...loose.edges],
      from: [...rooms.from, ...loose.from],
    };
  });
  if (floors.every((f) => f.walls.size === 0)) {
    return {
      problem: "This plot has no wall blocks left: its walls already stand between tiles.",
    };
  }
  const remove: PlanTile[] = [];
  const listed = new Set<string>();
  const take = (x: number, y: number, floor: number) => {
    if (listed.has(`${floor}:${x},${y}`)) return;
    listed.add(`${floor}:${x},${y}`);
    remove.push(floor === 0 ? { x, y } : { x, y, floor });
  };
  for (const key of [...(floors[0] as FloorPart).walls.keys()].sort(byRow)) {
    const [x, y] = xy(key);
    take(x, y, 0);
    for (let floor = 1; floor <= FLOORS.max; floor++) {
      const up = blocksOn(state, floor)[world(x, y)];
      if (up === undefined || groundOn(state, floor)[world(x, y)] !== undefined) break;
      take(x, y, floor);
      if (!HOLDING_BLOCKS.includes(up)) break;
    }
  }
  for (const [floor, f] of floors.entries()) {
    for (const key of floor === 0 ? [] : [...f.walls.keys()].sort(byRow)) take(...xy(key), floor);
  }
  const lines = floors.flatMap((f) => f.edges.map((edge, i) => ({ edge, from: f.from[i] ?? "" })));
  return { remove, edges: paidFor(state, px, py, remove, lines) };
}

/** An opening in a straight run of wall: the run's direction and the two walls at its ends. */
interface Gap {
  dir: XY;
  ends: [XY, XY];
}

/**
 * One floor's rooms: the wall blocks round them, and the lines that take their place.
 *
 * A gap is an opening of one tile, or two side by side, in a straight run of wall blocks: wall
 * blocks at both ends along the run, and none on either side across it. Gaps line up across a run
 * when a wall is two blocks thick, or a hedge stands in front of a door, so they're read as chains
 * across the run. A chain with a room at one end and the yard at the other is a way in: its gap
 * beside the room is a doorway, and so is each next one out while the walls at both its ends go on
 * along the run (a wall two blocks thick), which stops at a hedge in front of the door. A chain of
 * one gap between two rooms is a doorway between them. A chain of two or more gaps with a room at
 * each end is a room one tile wide, and a chain with the yard at each end is a gap in a yard wall.
 * A doorway counts as closed, like the door it stands for, so a home built before doors (decision
 * 0349) has an inside. Only a gap with no line across the way in counts, so a wall block left
 * outside a home already on lines never opens a doorway into it.
 *
 * The inside is every open tile, not a doorway, that a walk from the plot's edge can't reach
 * without crossing a wall block, a doorway, or a wall already on a line, less any walled-in nook
 * with something on every tile of it (a lantern with walls round it is no room). The walls
 * touching it, sides or corners, with no line between, come up, and the room grows into their
 * tiles and its doorways' tiles, and into each wall block with the room on two sides round a
 * corner. A door block comes up with the room only where it stands in a run of wall; a door on its
 * own beside a home is left to `looseFloor`. Every line
 * between the room and the outside gets a wall of the kind that stood there: a wall stays a wall, a
 * window a window, a door or a doorway a door. A line on the plot's own border moves one tile in,
 * since a wall there is refused, so a home on the plot's rim leaves that row as yard.
 *
 * A home of several rooms keeps them apart. The rooms are the inside's separate open areas, side
 * on, across no wall block, doorway or line. Each tile the room grows into joins one of them: the
 * room of its first side neighbour (north, east, south, west) that has one, across no line, taking
 * the tiles beside the rooms first and then the tiles beside those, and a corner neighbour only
 * where no side one has a room yet. Two tiles of different rooms side by side get a line between
 * them, of the kind that stood on one of them, a plain wall before a door or a window: a door or a
 * doorway in an inner wall stays a door, and the inner wall's ends stay walls.
 *
 * Upstairs is planned the same way but for what flooring decides, since a floor above the ground is
 * only as wide as its flooring and a line there needs flooring on one side (decision 0408). Walls
 * round no flooring at all wall in no room, and are left to `looseFloor`. The room grows only into
 * wall tiles with flooring, so a wall that stood on the wall below, with no flooring under it,
 * leaves its line on the flooring's edge. A line with no flooring on either side is left out. And a
 * doorway stays an opening with no line, since doors stay on the ground floor.
 */
function slimFloor(state: WorldState, px: number, py: number, floor: number): FloorPart {
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const blocks = blocksOn(state, floor);
  const flooring = groundOn(state, floor);
  const onPlot = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;
  const block = (x: number, y: number) => blocks[tileKey(x0 + x, y0 + y)];
  const wall = (x: number, y: number) => onPlot(x, y) && isWall(block(x, y));
  const open = (x: number, y: number) => onPlot(x, y) && block(x, y) === undefined;
  const lined = (x: number, y: number, side: Side) =>
    edgeAt(state, x0 + x, y0 + y, side, floor) !== undefined;
  // Whether the step from (x, y) by (dx, dy), one side on, crosses a wall on a line.
  const crossed = (x: number, y: number, dx: number, dy: number) => lined(x, y, sideTo(dx, dy));
  // Whether a tile is floor to stand on: every tile of the ground floor, and flooring upstairs.
  const floored = (key: string) => {
    if (floor === 0) return true;
    const [x, y] = xy(key);
    return flooring[tileKey(x0 + x, y0 + y)] !== undefined;
  };
  const none: FloorPart = { walls: new Map(), edges: [], from: [] };

  // The gaps, each with its run's direction and the walls at its ends.
  const gaps = new Map<string, Gap>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      for (const [dx, dy] of RUNS) {
        // Nothing stands across the run from it, on either side.
        const clear = (cx: number, cy: number) =>
          !wall(cx - dy, cy - dx) && !wall(cx + dy, cy + dx);
        if (!open(x, y) || !clear(x, y) || !wall(x - dx, y - dy)) continue;
        if (wall(x + dx, y + dy)) {
          gaps.set(at(x, y), {
            dir: [dx, dy],
            ends: [
              [x - dx, y - dy],
              [x + dx, y + dy],
            ],
          });
        } else if (open(x + dx, y + dy) && clear(x + dx, y + dy) && wall(x + 2 * dx, y + 2 * dy)) {
          const gap: Gap = {
            dir: [dx, dy],
            ends: [
              [x - dx, y - dy],
              [x + 2 * dx, y + 2 * dy],
            ],
          };
          gaps.set(at(x, y), gap);
          gaps.set(at(x + dx, y + dy), gap);
        }
      }
    }
  }
  // Pieces set into a wall: a block that isn't a wall (a kitchen, a planter) in a straight run of
  // wall blocks, with no wall across it. Each walls the room in as a doorway does, then stays
  // where it is, inside the room, with a line on its outer side.
  const setIn = new Map<string, [XY, XY]>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const piece = block(x, y);
      if (piece === undefined || isWall(piece)) continue;
      for (const [dx, dy] of RUNS) {
        const a: XY = [x - dy, y - dx];
        const b: XY = [x + dy, y + dx];
        if (!wall(x - dx, y - dy) || !wall(x + dx, y + dy) || wall(...a) || wall(...b)) continue;
        setIn.set(at(x, y), [a, b]);
      }
    }
  }

  // Open ground a walk from the plot's edge reaches, across no closed tile or line.
  const reached = (closed: (x: number, y: number) => boolean) => {
    const outside = new Set<string>();
    const queue: XY[] = [];
    for (let i = 0; i < S; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, S - 1],
        [0, i],
        [S - 1, i],
      ] as const) {
        if (!closed(x, y) && !outside.has(at(x, y))) {
          outside.add(at(x, y));
          queue.push([x, y]);
        }
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i] as XY;
      for (const { side, dx, dy } of SIDES) {
        const nx = x + dx;
        const ny = y + dy;
        if (!onPlot(nx, ny) || closed(nx, ny) || outside.has(at(nx, ny))) continue;
        if (lined(x, y, side)) continue;
        outside.add(at(nx, ny));
        queue.push([nx, ny]);
      }
    }
    return outside;
  };

  // First with every gap closed, to see which side of each chain of gaps a room is on.
  const first = (x: number, y: number) => wall(x, y) || gaps.has(at(x, y)) || setIn.has(at(x, y));
  const yard = reached(first);
  const enclosed = (x: number, y: number) => onPlot(x, y) && !first(x, y) && !yard.has(at(x, y));
  // Each walled-in area, side on, across no line, and whether any of it is bare floor: a nook
  // with something standing on every tile of it, like a lantern walled in beside a home, is no room.
  const areas = (member: (x: number, y: number) => boolean) => {
    const area = new Map<string, boolean>();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!member(x, y) || area.has(at(x, y))) continue;
        const flood: XY[] = [[x, y]];
        area.set(at(x, y), false);
        for (let i = 0; i < flood.length; i++) {
          const [fx, fy] = flood[i] as XY;
          for (const { side, dx, dy } of SIDES) {
            const [nx, ny] = [fx + dx, fy + dy];
            if (!member(nx, ny) || area.has(at(nx, ny)) || lined(fx, fy, side)) continue;
            area.set(at(nx, ny), false);
            flood.push([nx, ny]);
          }
        }
        const bare = flood.some(([fx, fy]) => block(fx, fy) === undefined);
        for (const [fx, fy] of flood) area.set(at(fx, fy), bare);
      }
    }
    return area;
  };
  const area = areas(enclosed);
  const roomy = (x: number, y: number) => area.get(at(x, y)) === true;
  const doorways = new Set<string>();
  const sameGap = (x: number, y: number, dir: XY) => {
    const g = gaps.get(at(x, y));
    return g !== undefined && g.dir[0] === dir[0] && g.dir[1] === dir[1];
  };
  // Whether a gap's walls go on past both its ends along the run, as a wall two blocks thick does.
  const goesOn = ({ dir: [dx, dy], ends: [a, b] }: Gap) =>
    wall(a[0] - dx, a[1] - dy) && wall(b[0] + dx, b[1] + dy);
  for (const [key, gap] of gaps) {
    const [x, y] = xy(key);
    const [dx, dy] = gap.dir;
    for (const out of [-1, 1]) {
      // A chain's head is the gap with a room just in from it, across the run.
      // A step across the run, out from the room, that crosses no line.
      const [sx, sy] = [out * dy, out * dx];
      const [ix, iy] = [x - sx, y - sy];
      if (!roomy(ix, iy) || crossed(x, y, -sx, -sy)) continue;
      const chain: XY[] = [[x, y]];
      let [cx, cy] = [x, y];
      while (sameGap(cx + sx, cy + sy, gap.dir) && !crossed(cx, cy, sx, sy)) {
        cx += sx;
        cy += sy;
        chain.push([cx, cy]);
      }
      const beyond = !crossed(cx, cy, sx, sy) && enclosed(cx + sx, cy + sy);
      if (beyond && chain.length > 1) continue;
      doorways.add(key);
      for (const [cx, cy] of chain.slice(1)) {
        if (!goesOn(gaps.get(at(cx, cy)) as Gap)) break;
        doorways.add(at(cx, cy));
      }
    }
  }

  // Then with only the doorways closed: the outside, and the inside.
  const closed = (x: number, y: number) =>
    wall(x, y) || doorways.has(at(x, y)) || setIn.has(at(x, y));
  const outside = reached(closed);
  const out = ([x, y]: XY) => !onPlot(x, y) || outside.has(at(x, y));
  // A piece set into a wall is the room's only from a side with no line between.
  const pieces = [...setIn]
    .filter(([key, ends]) => {
      const [x, y] = xy(key);
      return ends.some(([ex, ey]) => !out([ex, ey]) && !crossed(x, y, ex - x, ey - y));
    })
    .map(([key]) => key);
  const walledIn = areas((x, y) => onPlot(x, y) && !closed(x, y) && !outside.has(at(x, y)));
  const inside = new Set([...walledIn].filter(([, bare]) => bare).map(([key]) => key));
  // Upstairs, walls round no flooring at all wall in no room.
  if (![...inside].some(floored)) return none;

  // The walls that touch the room, sides or corners, across no line, come up and their tiles join
  // it, and so do the walls at the ends of each doorway.
  const taken = new Map<string, BlockKind>();
  // A door block comes up with the room only where it stands in a run of wall, so a lone door
  // beside a home is left to stand on its own rather than grow the room a tile.
  const takeWall = (x: number, y: number) => {
    if (!wall(x, y)) return;
    const kind = block(x, y) as BlockKind;
    const inRun = RUNS.some(([dx, dy]) => wall(x - dx, y - dy) && wall(x + dx, y + dy));
    if (kind !== "door" || inRun) taken.set(at(x, y), kind);
  };
  const touches = (x: number, y: number, dx: number, dy: number) => {
    if (dx === 0 || dy === 0) return !crossed(x, y, dx, dy);
    return (
      (!crossed(x, y, dx, 0) && !crossed(x + dx, y, 0, dy)) ||
      (!crossed(x, y, 0, dy) && !crossed(x, y + dy, dx, 0))
    );
  };
  for (const key of inside) {
    const [x, y] = xy(key);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dy !== 0) && touches(x, y, dx, dy)) takeWall(x + dx, y + dy);
      }
    }
  }
  for (const key of doorways) for (const end of (gaps.get(key) as Gap).ends) takeWall(...end);
  // A wall block with the room on two sides round a corner fills the room's corner.
  const inRoom = (x: number, y: number) => {
    const key = at(x, y);
    return inside.has(key) || taken.has(key) || doorways.has(key) || pieces.includes(key);
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!wall(x, y) || taken.has(at(x, y))) continue;
        const across = (dx: number, dy: number) => inRoom(x + dx, y + dy) && !crossed(x, y, dx, dy);
        const corner = [-1, 1].some((dx) => across(dx, 0) && [-1, 1].some((dy) => across(0, dy)));
        if (!corner) continue;
        takeWall(x, y);
        grew ||= taken.has(at(x, y));
      }
    }
  }
  if (taken.size === 0) return none;
  // What stood on each tile the room grows into: its block at its grade (RFC 0051), or a door for
  // a doorway. A line takes the kind and grade of the wall it stands for, so a fine brick home
  // slims into a fine brick home.
  const stood = new Map<string, Wall>();
  for (const [key, block] of taken) {
    const [x, y] = xy(key);
    stood.set(key, { block, grade: gradeAt(state, tileKey(x0 + x, y0 + y), floor) });
  }
  for (const key of doorways) stood.set(key, { block: "door", grade: "plain" });
  const counts = new Map<string, { wall: Wall; n: number }>();
  for (const wall of stood.values()) {
    if (!plain(wall.block)) continue;
    const unit = `${wall.block}:${wall.grade}`;
    const at = counts.get(unit) ?? { wall, n: 0 };
    counts.set(unit, { wall, n: at.n + 1 });
  }
  const most: Wall = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.wall ?? {
    block: "wood",
    grade: "plain",
  };

  // The room: inside, and the walls that came up, the doorways, and the pieces set into the walls
  // where there's floor, less the plot's own rim.
  const rim = (x: number, y: number) => x === 0 || y === 0 || x === S - 1 || y === S - 1;
  const room = new Set<string>();
  for (const key of [...inside, ...[...stood.keys(), ...pieces].filter(floored)]) {
    const [x, y] = xy(key);
    if (!rim(x, y)) room.add(key);
  }

  // Which of the inside's rooms each tile is in: the inside's own first, then the rest.
  const roomOf = new Map<string, number>();
  let rooms = 0;
  for (const start of inside) {
    if (roomOf.has(start)) continue;
    const id = rooms++;
    roomOf.set(start, id);
    const flood = [xy(start)];
    for (let i = 0; i < flood.length; i++) {
      const [x, y] = flood[i] as XY;
      for (const { side, dx, dy } of SIDES) {
        const next = at(x + dx, y + dy);
        if (!inside.has(next) || roomOf.has(next) || lined(x, y, side)) continue;
        roomOf.set(next, id);
        flood.push([x + dx, y + dy]);
      }
    }
  }
  let rest = [...room].filter((key) => !roomOf.has(key)).sort(byRow);
  let corners = false;
  while (rest.length > 0) {
    const found = new Map<string, number>();
    for (const key of rest) {
      const [x, y] = xy(key);
      const near = corners
        ? CORNERS.map(([dx, dy]) => at(x + dx, y + dy))
        : SIDES.filter(({ side }) => !lined(x, y, side)).map(({ dx, dy }) => at(x + dx, y + dy));
      const id = near.map((n) => roomOf.get(n)).find((r) => r !== undefined);
      if (id !== undefined) found.set(key, id);
    }
    if (found.size === 0) {
      if (corners) break;
      corners = true;
      continue;
    }
    corners = false;
    for (const [key, id] of found) roomOf.set(key, id);
    rest = rest.filter((key) => !roomOf.has(key));
  }
  for (const key of rest) roomOf.set(key, rooms++);

  // Between two rooms, a plain wall before a door or a window, and the tile it stood on.
  const pick = (key: string): [Wall, string] | undefined => {
    const wall = stood.get(key);
    return wall ? [wall, key] : undefined;
  };
  const between = (a: string, b: string): [Wall, string] => {
    const ka = pick(a);
    const kb = pick(b);
    if (!ka || !kb) return ka ?? kb ?? [most, ""];
    return plain(ka[0].block) || !plain(kb[0].block) ? ka : kb;
  };
  const edges: PlanEdge[] = [];
  const from: string[] = [];
  const seen = new Set<string>();
  for (const key of room) {
    const [x, y] = xy(key);
    for (const { side, dx, dy } of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      const next = at(nx, ny);
      if (lined(x, y, side)) continue;
      if (room.has(next) && roomOf.get(next) === roomOf.get(key)) continue;
      const line =
        side === "s" ? `${nx},${ny},n` : side === "e" ? `${nx},${ny},w` : `${x},${y},${side}`;
      if (seen.has(line)) continue;
      seen.add(line);
      // Facing out, the kind that stood there: the room's own tile if it was a wall, else the one
      // beyond it.
      const [wall, source] = room.has(next)
        ? between(key, next)
        : (pick(key) ?? pick(next) ?? [most, ""]);
      const kind = wall.block;
      if (floor === 0) {
        edges.push({ x, y, side, block: kind, ...gradeField(wall.grade) });
        from.push(source && `0:${source}`);
        continue;
      }
      // Upstairs a doorway stays open, and a line stands only beside flooring.
      if (kind === "door" || !(floored(key) || floored(next))) continue;
      edges.push({ x, y, side, floor, block: kind, ...gradeField(wall.grade) });
      from.push(source && `${floor}:${source}`);
    }
  }
  return { walls: taken, edges, from };
}

/** A straight run of loose wall blocks two or more long, along a row or down a column. */
interface Run {
  /** Along a row, or else down a column. */
  row: boolean;
  tiles: XY[];
}

/**
 * One floor's loose walls: every wall block no room took, each turned into a line of its own.
 *
 * A run of them along a row becomes the line on the north side of each of its tiles, or the south
 * side on the plot's top row, whose north side is the plot's border; a run down a column the line
 * on each tile's west side, or the east side on the plot's west column. Where a run along a row and
 * one down a column meet in a corner, each takes the side that meets the other there, so an L of
 * wall blocks stays an L of lines with no stub past the corner. A run that is only a wall's
 * thickness (a short run across a longer one, or a column as long as the rows it crosses) is left
 * to the longer one, and a wall two or more blocks thick puts up one line down its middle.
 *
 * A run whose line already stands on half its tiles or more, because it hugs a wall on a line or a
 * room's new wall, stands for that wall and puts up nothing. A block on its own does the same when
 * a wall touches it, on a side or at a corner, as a post at a home's corner does, and otherwise
 * takes the line on its north side, or the first of south, west and east that can stand. A door on its own just comes up. A line that can't stand
 * (the plot's border, across a public way, upstairs with no flooring on either side) is left out.
 */
function looseFloor(
  state: WorldState,
  px: number,
  py: number,
  floor: number,
  rooms: FloorPart,
): FloorPart {
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const blocks = blocksOn(state, floor);
  const flooring = groundOn(state, floor);
  const onPlot = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;
  const loose = new Map<string, BlockKind>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const block = blocks[tileKey(x0 + x, y0 + y)];
      if (isWall(block) && !rooms.walls.has(at(x, y))) loose.set(at(x, y), block);
    }
  }
  const walls = loose;
  const edges: PlanEdge[] = [];
  const from: string[] = [];
  if (loose.size === 0) return { walls, edges, from };
  const has = (x: number, y: number) => loose.has(at(x, y));

  // The lines that stand already or that the rooms put up, by `edgeKey` in world tiles.
  const planned = new Set(rooms.edges.map((e) => edgeKey(x0 + e.x, y0 + e.y, e.side)));
  const standing = (x: number, y: number, side: Side) =>
    planned.has(edgeKey(x0 + x, y0 + y, side)) ||
    edgeAt(state, x0 + x, y0 + y, side, floor) !== undefined;
  const floored = (x: number, y: number) =>
    floor === 0 || flooring[tileKey(x0 + x, y0 + y)] !== undefined;
  const STEP: Record<Side, XY> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  // Whether a new wall can stand on the line on `side` of (x, y).
  const fits = (x: number, y: number, side: Side, kind: BlockKind) => {
    const [dx, dy] = STEP[side];
    const nx = x + dx;
    const ny = y + dy;
    if (!onPlot(nx, ny) || standing(x, y, side)) return false;
    if (floor === 0) return !(isWay(state, x0 + x, y0 + y) && isWay(state, x0 + nx, y0 + ny));
    return kind !== "door" && (floored(x, y) || floored(nx, ny));
  };
  const put = (x: number, y: number, side: Side) => {
    const kind = loose.get(at(x, y)) as BlockKind;
    if (!fits(x, y, side, kind)) return;
    planned.add(edgeKey(x0 + x, y0 + y, side));
    const grade = gradeAt(state, tileKey(x0 + x, y0 + y), floor);
    edges.push({
      x,
      y,
      side,
      ...(floor === 0 ? {} : { floor }),
      block: kind,
      ...gradeField(grade),
    });
    from.push(`${floor}:${at(x, y)}`);
  };

  // The runs, along rows and down columns, and how long the run through each tile is each way.
  const runs: Run[] = [];
  const length = [new Map<string, number>(), new Map<string, number>()];
  for (const [i, [dx, dy]] of RUNS.entries()) {
    for (let a = 0; a < S; a++) {
      let tiles: XY[] = [];
      for (let b = 0; b <= S; b++) {
        const [x, y] = dx === 1 ? [b, a] : [a, b];
        if (b < S && has(x, y)) {
          tiles.push([x, y]);
          continue;
        }
        if (tiles.length >= 2) {
          runs.push({ row: i === 0, tiles });
          for (const [tx, ty] of tiles) length[i]?.set(at(tx, ty), tiles.length);
        }
        tiles = [];
      }
    }
  }
  const lengthOf = (row: boolean, [x, y]: XY) => length[row ? 0 : 1]?.get(at(x, y)) ?? 1;
  // A run that is only another's thickness goes, and so does one that stands for a wall already.
  const kept = runs.filter((r) => {
    const n = r.tiles.length;
    const thick = r.tiles.every((t) => (r.row ? lengthOf(false, t) > n : lengthOf(true, t) >= n));
    if (thick) return false;
    const sides: Side[] = r.row ? ["n", "s"] : ["w", "e"];
    const most = Math.max(
      ...sides.map((s) => r.tiles.filter(([x, y]) => standing(x, y, s)).length),
    );
    return most * 2 < n;
  });
  const live = [new Set<string>(), new Set<string>()];
  for (const r of kept) for (const [x, y] of r.tiles) live[r.row ? 0 : 1]?.add(at(x, y));
  const inRun = (row: boolean, x: number, y: number) => live[row ? 0 : 1]?.has(at(x, y)) ?? false;
  const inAnyRun = new Set(runs.flatMap((r) => r.tiles.map(([x, y]) => at(x, y))));

  for (const r of kept) {
    // Each corner with a run the other way says which side meets it there.
    const votes = new Map<Side, number>();
    const vote = (side: Side) => votes.set(side, (votes.get(side) ?? 0) + 1);
    for (const [x, y] of r.tiles) {
      if (!inRun(!r.row, x, y)) continue;
      // Across the run, the other run goes one way from here, or both.
      const [ax, ay] = r.row ? [0, 1] : [1, 0];
      const ahead = inRun(!r.row, x + ax, y + ay);
      const behind = inRun(!r.row, x - ax, y - ay);
      if (ahead === behind) continue;
      if (r.row) vote(ahead ? "n" : "s");
      else vote(ahead ? "w" : "e");
    }
    const [usual, other]: [Side, Side] = r.row ? ["n", "s"] : ["w", "e"];
    let side = (votes.get(other) ?? 0) > (votes.get(usual) ?? 0) ? other : usual;
    const [tx, ty] = r.tiles[0] as XY;
    const [sx, sy] = STEP[side];
    if (!onPlot(tx + sx, ty + sy)) side = side === usual ? other : usual;
    for (const [x, y] of r.tiles) {
      // A wall two or more blocks thick puts up one line, down its middle.
      const [ax, ay] = r.row ? [0, 1] : [1, 0];
      let before = 0;
      while (inRun(r.row, x - (before + 1) * ax, y - (before + 1) * ay)) before++;
      let after = 0;
      while (inRun(r.row, x + (after + 1) * ax, y + (after + 1) * ay)) after++;
      const thickness = before + after + 1;
      if (thickness === 1) put(x, y, side);
      else if (before === Math.floor(thickness / 2)) put(x, y, usual);
    }
  }

  // A block on its own.
  for (const [key, kind] of loose) {
    if (inAnyRun.has(key) || kind === "door") continue;
    const [x, y] = xy(key);
    // A wall touches one of its corners, as a post at a home's corner does.
    const near = [0, 1].some((cx) =>
      [0, 1].some((cy) => {
        const [vx, vy] = [x + cx, y + cy];
        return (
          standing(vx - 1, vy, "n") ||
          standing(vx, vy, "n") ||
          standing(vx, vy - 1, "w") ||
          standing(vx, vy, "w")
        );
      }),
    );
    if (near) continue;
    const side = (["n", "s", "w", "e"] as const).find((s) => fits(x, y, s, kind));
    if (side) put(x, y, side);
  }
  return { walls, edges, from };
}

/**
 * The plan's lines, none asking for more of a made material at a grade than the plan can pay for
 * (RFC 0051): the blocks of that kind and grade it takes up, and on a plot's first slim the town's
 * gift, at most a quarter more (`slimGift` in the sim). A corner block stands for two lines, so a
 * home with made corners would ask for more than it gives back. The lines past what a kind and
 * grade can pay for, a tile's second line first and then the last ones planned, go up as the first
 * that can be paid for of: the same kind plain, the home's other plain walls, most first, and glass
 * for a window or wood for a wall, which are free.
 */
function paidFor(
  state: WorldState,
  px: number,
  py: number,
  remove: readonly PlanTile[],
  lines: { edge: PlanEdge; from: string }[],
): PlanEdge[] {
  const S = state.config.plotSize;
  const unit = (block: BlockKind, grade: Grade = "plain") => `${block}:${grade}`;
  const had = new Map<string, number>();
  for (const t of remove) {
    const floor = t.floor ?? 0;
    const key = tileKey(px * S + t.x, py * S + t.y);
    const block = blocksOn(state, floor)[key];
    if (block === undefined) continue;
    const u = unit(block, gradeAt(state, key, floor));
    had.set(u, (had.get(u) ?? 0) + 1);
  }
  // The town tops up only a plot's first slim.
  const gift = state.slimmed?.[`${px},${py}`] === undefined;
  const cap = (block: BlockKind, grade: Grade = "plain") => {
    if (blockNeeds(block).length === 0) return Number.POSITIVE_INFINITY;
    const n = had.get(unit(block, grade)) ?? 0;
    return n + (gift ? Math.ceil(n / 4) : 0);
  };
  const used = new Map<string, number[]>();
  for (const [i, { edge }] of lines.entries()) {
    const u = unit(edge.block, edge.grade);
    used.set(u, [...(used.get(u) ?? []), i]);
  }
  const over: number[] = [];
  for (const [u, indices] of used) {
    const { block, grade } = (lines[indices[0] as number] as { edge: PlanEdge }).edge;
    const extra = indices.length - cap(block, grade);
    if (extra <= 0) continue;
    const seen = new Set<string>();
    const second: number[] = [];
    const first: number[] = [];
    for (const i of indices) {
      const tile = (lines[i] as { from: string }).from;
      if (tile && seen.has(tile)) second.push(i);
      else first.push(i);
      seen.add(tile);
    }
    const moved = [...second.reverse(), ...first.reverse()].slice(0, extra);
    used.set(
      u,
      indices.filter((i) => !moved.includes(i)),
    );
    over.push(...moved);
  }
  const plainWalls = [...had.entries()]
    .filter(([u]) => u.endsWith(":plain"))
    .map(([u, n]) => [u.slice(0, -":plain".length) as BlockKind, n] as const)
    .filter(([block]) => block !== "door" && !WINDOWS.includes(block))
    .sort((a, b) => b[1] - a[1])
    .map(([block]) => block);
  const out = lines.map(({ edge }) => edge);
  for (const i of over.sort((a, b) => a - b)) {
    const { grade: _, ...edge } = out[i] as PlanEdge;
    const free: BlockKind = WINDOWS.includes(edge.block) ? "glass" : "wood";
    const choices = WINDOWS.includes(edge.block) ? [edge.block] : [edge.block, ...plainWalls];
    const block = choices.find((b) => (used.get(unit(b))?.length ?? 0) < cap(b)) ?? free;
    used.set(unit(block), [...(used.get(unit(block)) ?? []), i]);
    out[i] = { ...edge, block };
  }
  return out;
}

/** A design note as the town's slim compares them: its code and the tiles it names. */
const noteKey = (n: { code: string; tiles: readonly { x: number; y: number }[] }) =>
  `${n.code} ${n.tiles.map((t) => `${t.x},${t.y}`).join(" ")}`;

/**
 * The town's slim of the home on plot (px, py) (decision 0404), with how many lines it walls and
 * how many things come back to the owner, or undefined where it would leave the home worse or half
 * done: nothing to plan, a refusal, anything skipped, anything spent from the owner's things past
 * what the old blocks and the town's gift cover, anything hung on an old wall taken down, or a
 * note, by its code and tiles, that the home didn't already have. Read-only: it slims a copy.
 */
export function townSlim(
  state: WorldState,
  px: number,
  py: number,
): { command: Extract<Command, { type: "town_slim" }>; walls: number; back: number } | undefined {
  const planned = slimPlan(state, px, py);
  if ("problem" in planned) return undefined;
  const command = { type: "town_slim" as const, px, py, ...planned };
  const prepared = prepare(state, { actor: TOWN_ACTOR, command });
  if (!prepared.ok || !prepared.plan) return undefined;
  const { plan } = prepared;
  if (plan.skipped.some((s) => s.why !== "same")) return undefined;
  if (plan.changes.some((c) => c.amount < 0)) return undefined;
  const after = cloneWorld(state);
  if (!apply(after, { actor: TOWN_ACTOR, command }).ok) return undefined;
  const hung = (w: WorldState) => Object.keys(w.items?.hung ?? {}).length;
  if (hung(after) !== hung(state)) return undefined;
  const had = new Set(designNotes(state, px, py).map(noteKey));
  if (designNotes(after, px, py).some((n) => !had.has(noteKey(n)))) return undefined;
  const back = plan.changes.filter((c) => c.amount > 0).reduce((n, c) => n + c.amount, 0);
  return { command, walls: plan.walled.length, back };
}

/**
 * The town's turning of every wall block on plot (px, py) into lines (the `walls_on_lines` sweep),
 * with how many lines it walls and how many things come back to the owner, or why not: no wall
 * blocks, or the sim refusing it as the owner's build. Unlike `townSlim` it takes what it can even
 * where something is skipped, a thing hung on an old wall goes back to whoever hung it, or a
 * design note is new, since every wall block has to go. It never spends the owner's things.
 */
export function townLines(
  state: WorldState,
  px: number,
  py: number,
):
  | { command: Extract<Command, { type: "town_slim" }>; walls: number; back: number }
  | { problem: string } {
  const planned = slimPlan(state, px, py);
  if ("problem" in planned) return planned;
  const command = { type: "town_slim" as const, px, py, ...planned };
  const prepared = prepare(state, { actor: TOWN_ACTOR, command });
  if (!prepared.ok) return { problem: prepared.rejection.message };
  const { plan } = prepared;
  if (!plan) return { problem: "The sim made no plan of it." };
  if (plan.changes.some((c) => c.amount < 0)) {
    return { problem: "It would take some of the owner's things." };
  }
  const back = plan.changes.filter((c) => c.amount > 0).reduce((n, c) => n + c.amount, 0);
  return { command, walls: plan.walled.length, back };
}

/** How many wall blocks stand on plot (px, py), on every floor. */
export function wallBlocksOn(state: WorldState, px: number, py: number): number {
  const S = state.config.plotSize;
  let n = 0;
  for (let floor = 0; floor <= FLOORS.max; floor++) {
    const blocks = blocksOn(state, floor);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (isWall(blocks[tileKey(px * S + x, py * S + y)])) n++;
      }
    }
  }
  return n;
}
