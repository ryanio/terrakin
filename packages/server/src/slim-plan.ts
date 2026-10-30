import {
  apply,
  type BlockKind,
  blocksOn,
  type Command,
  cloneWorld,
  designNotes,
  edgeAt,
  FLOORS,
  type Grade,
  gradeAt,
  gradeField,
  groundOn,
  HOLDING_BLOCKS,
  type PlanEdge,
  type PlanTile,
  prepare,
  type Side,
  TOWN_ACTOR,
  tileKey,
  type WorldState,
} from "@terrakin/sim";

/** Whether a block is part of a home's walls: a wall, a window, a hedge, or a door. */
const isWall = (block: BlockKind | undefined): block is BlockKind =>
  block !== undefined && (HOLDING_BLOCKS.includes(block) || block === "leaf" || block === "door");

/** The window kinds, which stay where they stood but never stand for the home's walls. */
const WINDOWS: readonly BlockKind[] = ["glass", "sea_glass_pane"];

/** A plain wall: not a door and not a window. */
const plain = (kind: BlockKind) => kind !== "door" && !WINDOWS.includes(kind);

const SIDES: readonly { side: Side; dx: number; dy: number }[] = [
  { side: "n", dx: 0, dy: -1 },
  { side: "e", dx: 1, dy: 0 },
  { side: "s", dx: 0, dy: 1 },
  { side: "w", dx: -1, dy: 0 },
];

const CORNERS: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const xy = (key: string) => key.split(",").map(Number) as [number, number];
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

/** One floor's part of a slim: the wall blocks it takes up and the lines it puts up. */
interface FloorSlim {
  /** Whether a room is walled in by blocks or lines on this floor. */
  room: boolean;
  taken: Map<string, BlockKind>;
  edges: PlanEdge[];
}

/**
 * The plan that turns the wall blocks of the home on plot (px, py) into walls between tiles (RFC
 * 0050), as a `slim_walls` logs it: the blocks it takes up and the lines it walls, in plot
 * coordinates, on the ground floor and on every floor above it (`slimFloor`). Pure, so replay never
 * runs it; the sim checks what it logs as the resident's own build.
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
  const at = (x: number, y: number) => tileKey(px * S + x, py * S + y);
  const floors = Array.from({ length: FLOORS.max + 1 }, (_, floor) =>
    slimFloor(state, px, py, floor),
  );
  if (!floors.some((f) => f.room)) {
    return { problem: "There's no room walled in by blocks on this plot to slim." };
  }
  if (floors.every((f) => f.taken.size === 0)) {
    return {
      problem: "This home has no wall blocks left to slim: its walls already stand between tiles.",
    };
  }
  const remove: PlanTile[] = [];
  const listed = new Set<string>();
  const take = (x: number, y: number, floor: number) => {
    if (listed.has(`${floor}:${x},${y}`)) return;
    listed.add(`${floor}:${x},${y}`);
    remove.push(floor === 0 ? { x, y } : { x, y, floor });
  };
  for (const key of (floors[0] as FloorSlim).taken.keys()) {
    const [x, y] = xy(key);
    take(x, y, 0);
    for (let floor = 1; floor <= FLOORS.max; floor++) {
      const up = blocksOn(state, floor)[at(x, y)];
      if (up === undefined || groundOn(state, floor)[at(x, y)] !== undefined) break;
      take(x, y, floor);
      if (!HOLDING_BLOCKS.includes(up)) break;
    }
  }
  for (const [floor, f] of floors.entries()) {
    for (const key of floor === 0 ? [] : f.taken.keys()) take(...xy(key), floor);
  }
  return { remove, edges: floors.flatMap((f) => f.edges) };
}

/**
 * One floor of a slim: the wall blocks round its rooms, and the lines that take their place.
 *
 * A doorway is an open tile in a straight run of wall blocks: wall blocks on both its sides along
 * the run, none on either side across it (the shape `doorwayWithoutDoor` reads), and neither tile
 * across it of that shape too, which would make it part of a room one tile wide. It counts as
 * closed, like the door it stands for, so a home built before doors (decision 0349) has an inside.
 * A doorway with the outside on both sides of it is only a gap in a yard wall, and stays outside.
 *
 * The inside is every open tile, not a doorway, that a walk from the plot's edge can't reach
 * without crossing a wall block, a doorway, or a wall already on a line. The walls touching it,
 * sides or corners, come up, and the room grows into their tiles and its doorways' tiles. Every line
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
 * round no flooring at all wall in no room, so they stay. The room grows only into wall tiles with
 * flooring, so a wall that stood on the wall below, with no flooring under it, leaves its line on
 * the flooring's edge. A line with no flooring on either side is left out. And a doorway stays an
 * opening with no line, since doors stay on the ground floor.
 */
function slimFloor(state: WorldState, px: number, py: number, floor: number): FloorSlim {
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const blocks = blocksOn(state, floor);
  const flooring = groundOn(state, floor);
  const onPlot = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;
  const block = (x: number, y: number) => blocks[tileKey(x0 + x, y0 + y)];
  const wall = (x: number, y: number) => onPlot(x, y) && isWall(block(x, y));
  const lined = (x: number, y: number, side: Side) =>
    edgeAt(state, x0 + x, y0 + y, side, floor) !== undefined;
  // Whether a tile is floor to stand on: every tile of the ground floor, and flooring upstairs.
  const floored = (key: string) => {
    if (floor === 0) return true;
    const [x, y] = xy(key);
    return flooring[tileKey(x0 + x, y0 + y)] !== undefined;
  };

  // The doorways, each with the two tiles across it. An open tile between two wall blocks across
  // from it too is a room one tile wide, so neither it nor its neighbour is a doorway.
  const walledAlong = (x: number, y: number, dx: number, dy: number) =>
    onPlot(x, y) && block(x, y) === undefined && wall(x - dx, y - dy) && wall(x + dx, y + dy);
  const gaps = new Map<string, [[number, number], [number, number]]>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const a: [number, number] = [x - dy, y - dx];
        const b: [number, number] = [x + dy, y + dx];
        if (!walledAlong(x, y, dx, dy) || wall(...a) || wall(...b)) continue;
        if (walledAlong(...a, dx, dy) || walledAlong(...b, dx, dy)) continue;
        gaps.set(`${x},${y}`, [a, b]);
      }
    }
  }
  const closed = (x: number, y: number) => wall(x, y) || gaps.has(`${x},${y}`);

  // The outside: open ground a walk from the plot's edge reaches, across no wall, doorway or line.
  const outside = new Set<string>();
  const queue: [number, number][] = [];
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [
      [i, 0],
      [i, S - 1],
      [0, i],
      [S - 1, i],
    ] as const) {
      if (!closed(x, y) && !outside.has(`${x},${y}`)) {
        outside.add(`${x},${y}`);
        queue.push([x, y]);
      }
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    for (const { side, dx, dy } of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      if (!onPlot(nx, ny) || closed(nx, ny) || outside.has(`${nx},${ny}`)) continue;
      if (lined(x, y, side)) continue;
      outside.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  const out = ([x, y]: [number, number]) => !onPlot(x, y) || outside.has(`${x},${y}`);
  const doorways = [...gaps].filter(([, [a, b]]) => !(out(a) && out(b))).map(([key]) => key);
  const inside = new Set<string>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!closed(x, y) && !outside.has(`${x},${y}`)) inside.add(`${x},${y}`);
    }
  }
  // Upstairs, walls round no flooring at all wall in no room: a parapet stays a parapet.
  if (![...inside].some(floored)) return { room: false, taken: new Map(), edges: [] };

  // The walls that touch the room, sides or corners, come up and their tiles join it.
  const taken = new Map<string, BlockKind>();
  for (const key of inside) {
    const [x, y] = xy(key);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (wall(x + dx, y + dy))
          taken.set(`${x + dx},${y + dy}`, block(x + dx, y + dy) as BlockKind);
      }
    }
  }
  if (taken.size === 0) return { room: true, taken, edges: [] };
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

  // The room: inside, and the walls that came up and the doorways where there's floor, less the
  // plot's own rim.
  const rim = (x: number, y: number) => x === 0 || y === 0 || x === S - 1 || y === S - 1;
  const room = new Set<string>();
  for (const key of [...inside, ...[...stood.keys()].filter(floored)]) {
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
      const [x, y] = flood[i] as [number, number];
      for (const { side, dx, dy } of SIDES) {
        const next = `${x + dx},${y + dy}`;
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
        ? CORNERS.map(([dx, dy]) => `${x + dx},${y + dy}`)
        : SIDES.filter(({ side }) => !lined(x, y, side)).map(({ dx, dy }) => `${x + dx},${y + dy}`);
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

  // Between two rooms, a plain wall before a door or a window.
  const between = (a: string, b: string): Wall => {
    const ka = stood.get(a);
    const kb = stood.get(b);
    if (!ka || !kb) return ka ?? kb ?? most;
    return plain(ka.block) || !plain(kb.block) ? ka : kb;
  };
  const edges: PlanEdge[] = [];
  const seen = new Set<string>();
  for (const key of room) {
    const [x, y] = xy(key);
    for (const { side, dx, dy } of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      const next = `${nx},${ny}`;
      if (lined(x, y, side)) continue;
      if (room.has(next) && roomOf.get(next) === roomOf.get(key)) continue;
      const line =
        side === "s" ? `${nx},${ny},n` : side === "e" ? `${nx},${ny},w` : `${x},${y},${side}`;
      if (seen.has(line)) continue;
      seen.add(line);
      // Facing out, the kind that stood there: the room's own tile if it was a wall, else the one
      // beyond it.
      const wall = room.has(next)
        ? between(key, next)
        : (stood.get(key) ?? stood.get(next) ?? most);
      const kind = wall.block;
      if (floor === 0) {
        edges.push({ x, y, side, block: kind, ...gradeField(wall.grade) });
        continue;
      }
      // Upstairs a doorway stays open, and a line stands only beside flooring.
      if (kind === "door" || !(floored(key) || floored(next))) continue;
      edges.push({ x, y, side, floor, block: kind, ...gradeField(wall.grade) });
    }
  }
  return { room: true, taken, edges };
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
