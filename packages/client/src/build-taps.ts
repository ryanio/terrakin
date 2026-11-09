/**
 * What a tap in the build bar acts on (decision 0429). Pure and tested (`build-taps.test.ts`):
 * `world.ts` asks it for every build tap and for the mark under a mouse, then sends the action it
 * names; the world still checks everything.
 *
 * Two rules. A pick only ever adds: on an empty tile or line it places, on a piece of the same kind
 * facing another way it turns, and on anything else it says what's there. Remove only ever takes
 * away: the wall on a line near the tap, else the block on the tile, else (on the Paths tab) the
 * path under it. So a tap that lands a little off never does the opposite of what was meant.
 *
 * Walls, windows, hedges and doors go on the lines between tiles. Which line comes from where the
 * tap touched the ground, in tiles (a tile's middle is its coordinate, so it spans half a tile each
 * way), measured to every line around it rather than only the four sides of the tile it fell in.
 */
import {
  type BlockKind,
  chebyshev,
  type EdgeSide,
  edgeTiles,
  type GroundKind,
  isSurface,
  isTurnable,
  type Side,
  type Tile,
  type Turn,
} from "@terrakin/sim";

/** A place on the ground in tiles, fractional: (3, 4) is the middle of tile 3,4. */
export interface GroundPoint {
  x: number;
  y: number;
}

/** A line between tiles, by the tile that owns it and its north or west side (the sim's key). */
export interface Line {
  x: number;
  y: number;
  side: EdgeSide;
}

/** What a tap marks and acts on: a line between tiles or a tile. */
export type BuildSpot = ({ kind: "line" } & Line) | ({ kind: "tile" } & Tile);

/** The build bar's pick, as far as a tap cares. */
export type BuildPick =
  | { kind: "remove"; paths: boolean }
  | { kind: "line"; block: BlockKind }
  | { kind: "ground"; ground: GroundKind }
  | { kind: "hearth" }
  | { kind: "pot" }
  | { kind: "block"; block: BlockKind; turn: Turn };

/** What's built where a tap lands, on the floor the bar builds on. */
export interface BuildGround {
  edgeAt(line: Line): BlockKind | undefined;
  blockAt(x: number, y: number): BlockKind | undefined;
  pavingAt(x: number, y: number): GroundKind | undefined;
  turnAt(x: number, y: number): Turn;
}

/** Where a tap touched the world. */
export interface BuildTouch {
  /** The tile it fell in: on the map the one under the finger, in 3D the one the ray reached. */
  tile: Tile;
  /** Where it touched the ground. */
  point: GroundPoint;
  /** The line of the wall a 3D ray hit, when it hit one. */
  line?: Line | undefined;
}

/** What a build tap does. `spot` is what it marks. */
export type BuildTap =
  | { do: "place_line"; spot: BuildSpot; line: Line }
  | { do: "remove_line"; spot: BuildSpot; line: Line; block: BlockKind }
  | { do: "place"; spot: BuildSpot; tile: Tile }
  | { do: "set_hearth"; spot: BuildSpot; tile: Tile }
  | { do: "lay"; spot: BuildSpot; tile: Tile }
  | { do: "put_on"; spot: BuildSpot; tile: Tile }
  | { do: "turn"; spot: BuildSpot; tile: Tile; turn: Turn }
  | { do: "remove"; spot: BuildSpot; tile: Tile; block: BlockKind }
  | { do: "lift"; spot: BuildSpot; tile: Tile; ground: GroundKind }
  /** A pick tapped on something already there: say what it is, change nothing. */
  | { do: "taken"; spot: BuildSpot; block?: BlockKind; ground?: GroundKind; line?: boolean }
  /** Remove tapped where there's nothing it takes. */
  | { do: "nothing"; spot: BuildSpot };

/**
 * How far from a tap, in tiles, Remove looks for a wall on a line when the tile holds nothing else
 * it could mean: past the tile's middle, so a tap anywhere in a tile beside a wall takes the wall.
 */
const REMOVE_LINE_FAR = 0.6;
/**
 * How far it looks when the tile holds a block (or, on the Paths tab, a path) it could mean
 * instead: only a tap close to the line takes the wall.
 */
const REMOVE_LINE_NEAR = 0.22;
/** Every line within `radius` tiles of a point, nearest first, with how far each is. */
export function linesNear(p: GroundPoint, radius: number): (Line & { distance: number })[] {
  const out: (Line & { distance: number })[] = [];
  const reach = Math.ceil(radius) + 1;
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let y = cy - reach; y <= cy + reach + 1; y++) {
    for (let x = cx - reach; x <= cx + reach + 1; x++) {
      // The north side of (x, y) runs along y - 0.5 from x - 0.5 to x + 0.5; the west side along
      // x - 0.5 from y - 0.5 to y + 0.5.
      const north = toSegment(p.x - x, p.y - (y - 0.5));
      if (north <= radius) out.push({ x, y, side: "n", distance: north });
      const west = toSegment(p.y - y, p.x - (x - 0.5));
      if (west <= radius) out.push({ x, y, side: "w", distance: west });
    }
  }
  return out.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
}

/** How far a point is from a unit segment: `along` from its middle, `off` to one side of it. */
function toSegment(along: number, off: number): number {
  const past = Math.max(0, Math.abs(along) - 0.5);
  return Math.hypot(past, off);
}

/** The line nearest a point. Every point has one within half a tile. */
export function nearestLine(p: GroundPoint): Line {
  const [line] = linesNear(p, 0.5);
  if (!line) throw new Error("no line within half a tile");
  return { x: line.x, y: line.y, side: line.side };
}

const lineSpot = (l: Line): BuildSpot => ({ kind: "line", x: l.x, y: l.y, side: l.side });
const tileSpot = (t: Tile): BuildSpot => ({ kind: "tile", x: t.x, y: t.y });

/** What a tap does with this pick, on what's built here now. */
export function buildTap(pick: BuildPick, touch: BuildTouch, ground: BuildGround): BuildTap {
  const { tile, point } = touch;
  const block = ground.blockAt(tile.x, tile.y);
  const spot = tileSpot(tile);
  switch (pick.kind) {
    case "remove": {
      const paving = pick.paths ? ground.pavingAt(tile.x, tile.y) : undefined;
      // A wall a 3D ray hit is the one meant.
      const hit = touch.line && ground.edgeAt(touch.line);
      if (touch.line && hit) {
        return { do: "remove_line", spot: lineSpot(touch.line), line: touch.line, block: hit };
      }
      const radius = block || paving ? REMOVE_LINE_NEAR : REMOVE_LINE_FAR;
      for (const line of linesNear(point, radius)) {
        const wall = ground.edgeAt(line);
        if (!wall) continue;
        const at = { x: line.x, y: line.y, side: line.side };
        return { do: "remove_line", spot: lineSpot(at), line: at, block: wall };
      }
      if (block) return { do: "remove", spot, tile, block };
      if (paving) return { do: "lift", spot, tile, ground: paving };
      return { do: "nothing", spot };
    }
    case "line": {
      const near = touch.line ?? nearestLine(point);
      const there = ground.edgeAt(near);
      if (!there) return { do: "place_line", spot: lineSpot(near), line: near };
      // Taken: say what's there, and put nothing up on another line the tap didn't mean.
      return { do: "taken", spot: lineSpot(near), block: there, line: true };
    }
    case "ground": {
      const paving = ground.pavingAt(tile.x, tile.y);
      if (paving) return { do: "taken", spot, ground: paving };
      return { do: "lay", spot, tile };
    }
    case "hearth":
      return block ? { do: "taken", spot, block } : { do: "set_hearth", spot, tile };
    case "pot":
      // A vase or pot of yours stands on a table or a shelf; the kitchen is a station, so not there.
      if (isSurface(block) && block !== "kitchen") return { do: "put_on", spot, tile };
      return block ? { do: "taken", spot, block } : { do: "place", spot, tile };
    case "block": {
      if (!block) return { do: "place", spot, tile };
      // The same piece facing another way turns to the way the picker says.
      if (block === pick.block && isTurnable(block)) {
        const turn = ground.turnAt(tile.x, tile.y);
        if (turn !== pick.turn) return { do: "turn", spot, tile, turn: pick.turn };
      }
      return { do: "taken", spot, block };
    }
  }
}

/**
 * A line as an action names it: by whichever of its two tiles is nearer `me`, with the side that
 * faces the other, since the world measures reach to the tile an action names.
 */
export function lineFrom(line: Line, me: Tile): Tile & { side: Side } {
  const [a, b] = edgeTiles(line.x, line.y, line.side);
  const far = (t: Tile) => chebyshev(t, me);
  if (far(a) < far(b)) return { ...a, side: line.side === "n" ? "s" : "e" };
  return { ...b, side: line.side };
}

/** The tile a build tap's action names, for the reach check before it's sent. */
export function tileActedOn(tap: BuildTap, me: Tile): Tile {
  if (tap.do === "place_line" || tap.do === "remove_line") {
    const { x, y } = lineFrom(tap.line, me);
    return { x, y };
  }
  return { x: tap.spot.x, y: tap.spot.y };
}
