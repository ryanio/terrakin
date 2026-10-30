import {
  type BlockKind,
  edgeAt,
  HOLDING_BLOCKS,
  type PlanEdge,
  type PlanTile,
  type Side,
  tileKey,
  type WorldState,
} from "@terrakin/sim";

/** Whether a block is part of a home's walls: a wall, a window, a hedge, or a door. */
const isWall = (block: BlockKind | undefined): block is BlockKind =>
  block !== undefined && (HOLDING_BLOCKS.includes(block) || block === "leaf" || block === "door");

const SIDES: readonly { side: Side; dx: number; dy: number }[] = [
  { side: "n", dx: 0, dy: -1 },
  { side: "e", dx: 1, dy: 0 },
  { side: "s", dx: 0, dy: 1 },
  { side: "w", dx: -1, dy: 0 },
];

/**
 * The plan that turns the wall blocks of the home on plot (px, py)'s ground floor into walls between
 * tiles (RFC 0050), as a `slim_walls` logs it: the blocks it takes up and the lines it walls, in
 * plot coordinates. Pure, so replay never runs it; the sim checks what it logs as the resident's
 * own build.
 *
 * The inside is every open tile a walk from the plot's edge can't reach without crossing a wall
 * block or a wall already on a line. The walls touching it come up, and the room grows into their
 * tiles. Every line between the room and the outside gets a wall of the kind that stood there:
 * a wall stays a wall, a window a window, the door a door. A line on the plot's own border moves one
 * tile in, since a wall there is refused, so a home on the plot's rim leaves that row as yard.
 */
export function slimPlan(
  state: WorldState,
  px: number,
  py: number,
): { remove: PlanTile[]; edges: PlanEdge[] } | { problem: string } {
  const S = state.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const onPlot = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;
  const block = (x: number, y: number) => state.blocks[tileKey(x0 + x, y0 + y)];
  const wall = (x: number, y: number) => onPlot(x, y) && isWall(block(x, y));
  const lined = (x: number, y: number, side: Side) =>
    edgeAt(state, x0 + x, y0 + y, side) !== undefined;

  // The outside: open ground a walk from the plot's edge reaches, across no wall and no line.
  const outside = new Set<string>();
  const queue: [number, number][] = [];
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [
      [i, 0],
      [i, S - 1],
      [0, i],
      [S - 1, i],
    ] as const) {
      if (!wall(x, y) && !outside.has(`${x},${y}`)) {
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
      if (!onPlot(nx, ny) || wall(nx, ny) || outside.has(`${nx},${ny}`)) continue;
      if (lined(x, y, side)) continue;
      outside.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  const inside = new Set<string>();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!wall(x, y) && !outside.has(`${x},${y}`)) inside.add(`${x},${y}`);
    }
  }
  if (inside.size === 0) {
    return { problem: "There's no room walled in by blocks on this plot to slim." };
  }

  // The walls that touch the room, sides or corners, come up and their tiles join it.
  const taken = new Map<string, BlockKind>();
  for (const key of inside) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (wall(x + dx, y + dy))
          taken.set(`${x + dx},${y + dy}`, block(x + dx, y + dy) as BlockKind);
      }
    }
  }
  if (taken.size === 0) {
    return {
      problem: "This home has no wall blocks left to slim: its walls already stand between tiles.",
    };
  }
  const counts = new Map<BlockKind, number>();
  for (const kind of taken.values()) {
    if (kind !== "door" && kind !== "glass" && kind !== "sea_glass_pane") {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const most = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "wood") as BlockKind;

  // The room: inside and the walls that came up, less the plot's own rim.
  const rim = (x: number, y: number) => x === 0 || y === 0 || x === S - 1 || y === S - 1;
  const room = new Set<string>();
  for (const key of [...inside, ...taken.keys()]) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (!rim(x, y)) room.add(key);
  }
  const edges: PlanEdge[] = [];
  const seen = new Set<string>();
  for (const key of room) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    for (const { side, dx, dy } of SIDES) {
      const nx = x + dx;
      const ny = y + dy;
      if (room.has(`${nx},${ny}`) || lined(x, y, side)) continue;
      const line =
        side === "s" ? `${nx},${ny},n` : side === "e" ? `${nx},${ny},w` : `${x},${y},${side}`;
      if (seen.has(line)) continue;
      seen.add(line);
      // The kind that stood there: the room's own tile if it was a wall, else the one beyond it.
      const kind = taken.get(key) ?? taken.get(`${nx},${ny}`) ?? most;
      edges.push({ x, y, side, block: kind });
    }
  }
  const remove: PlanTile[] = [...taken.keys()].map((key) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return { x, y };
  });
  return { remove, edges };
}
