import { type BlockKind, edgeKey, type GroundKind, type Turn } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  type BuildGround,
  type BuildPick,
  buildTap,
  type Line,
  lineFrom,
  linesNear,
  nearestLine,
  tileActedOn,
} from "./build-taps";

/** A bit of a plot: walls by the sim's own edge key, blocks, paths, and turns by tile. */
function ground(o: {
  edges?: Record<string, BlockKind>;
  blocks?: Record<string, BlockKind>;
  paving?: Record<string, GroundKind>;
  turns?: Record<string, Turn>;
}): BuildGround {
  return {
    edgeAt: (l: Line) => o.edges?.[edgeKey(l.x, l.y, l.side)],
    blockAt: (x, y) => o.blocks?.[`${x},${y}`],
    pavingAt: (x, y) => o.paving?.[`${x},${y}`],
    turnAt: (x, y) => o.turns?.[`${x},${y}`] ?? 0,
  };
}

/** A tap at a point on the ground, in the tile it falls in, as the map reads one. */
const at = (x: number, y: number) => ({
  tile: { x: Math.round(x), y: Math.round(y) },
  point: { x, y },
});

const wood: BuildPick = { kind: "line", block: "wood" };
const remove: BuildPick = { kind: "remove", paths: false };
const removePaths: BuildPick = { kind: "remove", paths: true };

describe("which line a point is nearest", () => {
  it("is the side of the tile the point is closest to", () => {
    expect(nearestLine({ x: 5, y: 4.4 })).toEqual({ x: 5, y: 5, side: "n" });
    expect(nearestLine({ x: 4.6, y: 4 })).toEqual({ x: 5, y: 4, side: "w" });
    expect(nearestLine({ x: 5.2, y: 3.7 })).toEqual({ x: 5, y: 4, side: "n" });
  });

  it("finds a line in the next tile over when the tap is past the end of the tile's own", () => {
    // Just past a corner: the line running on from the neighbour is as near as the tile's own.
    const near = linesNear({ x: 5.45, y: 4.45 }, 0.1).map(({ x, y, side }) => ({ x, y, side }));
    expect(near).toContainEqual({ x: 6, y: 5, side: "n" });
    expect(near).toContainEqual({ x: 6, y: 5, side: "w" });
    expect(near).toContainEqual({ x: 5, y: 5, side: "n" });
    expect(near).toContainEqual({ x: 6, y: 4, side: "w" });
  });
});

describe("a tap with a wall picked", () => {
  it("puts it on the line by the tap, whichever tile the finger landed in", () => {
    // Tapped a little over the line into the tile south of it: still that line.
    expect(buildTap(wood, at(5, 4.55), ground({}))).toMatchObject({
      do: "place_line",
      line: { x: 5, y: 5, side: "n" },
    });
  });

  it("says what's there on a taken line, and never takes it down", () => {
    const g = ground({ edges: { [edgeKey(5, 5, "n")]: "stone" } });
    expect(buildTap(wood, at(5, 4.6), g)).toMatchObject({
      do: "taken",
      block: "stone",
      spot: { kind: "line", x: 5, y: 5, side: "n" },
    });
  });

  it("carries the wall round a corner when the taken line is barely nearer than an empty one", () => {
    const g = ground({ edges: { [edgeKey(5, 5, "n")]: "wood" } });
    // By the corner where the taken line meets the east side of the tile.
    expect(buildTap(wood, at(5.38, 4.4), g)).toMatchObject({
      do: "place_line",
      line: { x: 6, y: 4, side: "w" },
    });
  });

  it("takes the wall a 3D ray hit as the line meant", () => {
    const line = { x: 2, y: 2, side: "w" } as const;
    expect(buildTap(wood, { ...at(2, 2), line }, ground({}))).toMatchObject({
      do: "place_line",
      line,
    });
  });
});

describe("a tap with Remove", () => {
  it("takes down a wall on a line near the tap, from anywhere in an empty tile beside it", () => {
    const g = ground({ edges: { [edgeKey(5, 4, "w")]: "door" } });
    // Well into the tile, past its middle, and still the door: nothing else there to mean.
    expect(buildTap(remove, at(5.05, 4.2), g)).toMatchObject({
      do: "remove_line",
      line: { x: 5, y: 4, side: "w" },
      block: "door",
    });
  });

  it("takes the block on the tile over a wall beside it unless the tap is right by the line", () => {
    const g = ground({
      edges: { [edgeKey(5, 4, "w")]: "wood" },
      blocks: { "5,4": "table" },
    });
    expect(buildTap(remove, at(4.8, 4), g)).toMatchObject({ do: "remove", block: "table" });
    expect(buildTap(remove, at(4.6, 4), g)).toMatchObject({ do: "remove_line", block: "wood" });
  });

  it("lifts the path only on the Paths tab, and only once nothing stands on it", () => {
    const g = ground({ paving: { "3,3": "dirt" }, blocks: { "4,3": "chair" } });
    expect(buildTap(remove, at(3, 3), g)).toMatchObject({ do: "nothing" });
    expect(buildTap(removePaths, at(3, 3), g)).toMatchObject({ do: "lift", ground: "dirt" });
    const under = ground({ paving: { "4,3": "dirt" }, blocks: { "4,3": "chair" } });
    expect(buildTap(removePaths, at(4, 3), under)).toMatchObject({ do: "remove", block: "chair" });
  });

  it("never places anything, whatever is or isn't there", () => {
    expect(buildTap(remove, at(7, 7), ground({}))).toEqual({
      do: "nothing",
      spot: { kind: "tile", x: 7, y: 7 },
    });
  });
});

describe("a tap with a block, a path, a pot, or the hearth picked", () => {
  const table: BuildPick = { kind: "block", block: "table", turn: 180 };

  it("places on an empty tile, and says what's on a full one rather than taking it up", () => {
    expect(buildTap(table, at(1, 1), ground({}))).toMatchObject({
      do: "place",
      tile: { x: 1, y: 1 },
    });
    const g = ground({ blocks: { "1,1": "planter" } });
    expect(buildTap(table, at(1, 1), g)).toMatchObject({ do: "taken", block: "planter" });
  });

  it("turns a piece of the picked kind facing another way, and leaves one already facing it", () => {
    const g = ground({ blocks: { "1,1": "table" } });
    expect(buildTap(table, at(1, 1), g)).toMatchObject({ do: "turn", turn: 180 });
    // Another kind picked, or a piece that doesn't turn (a low stone wall): left as it is.
    const sofa = ground({ blocks: { "1,1": "sofa" } });
    expect(buildTap(table, at(1, 1), sofa)).toMatchObject({ do: "taken", block: "sofa" });
    const low = ground({ blocks: { "1,1": "stone_wall" } });
    const lowPick: BuildPick = { kind: "block", block: "stone_wall", turn: 90 };
    expect(buildTap(lowPick, at(1, 1), low)).toMatchObject({ do: "taken" });
    const turned = ground({ blocks: { "1,1": "table" }, turns: { "1,1": 180 } });
    expect(buildTap(table, at(1, 1), turned)).toMatchObject({ do: "taken", block: "table" });
  });

  it("lays a path on bare ground and says what's laid on a tile that has one", () => {
    const dirt: BuildPick = { kind: "ground", ground: "dirt" };
    expect(buildTap(dirt, at(2, 2), ground({}))).toMatchObject({ do: "lay" });
    const g = ground({ paving: { "2,2": "cobble" } });
    expect(buildTap(dirt, at(2, 2), g)).toMatchObject({ do: "taken", ground: "cobble" });
  });

  it("stands a pot on a table or a shelf, never on the kitchen, and sets it down on bare ground", () => {
    const pot: BuildPick = { kind: "pot" };
    const g = ground({ blocks: { "1,1": "table", "2,1": "bookshelf", "3,1": "kitchen" } });
    expect(buildTap(pot, at(1, 1), g)).toMatchObject({ do: "put_on", tile: { x: 1, y: 1 } });
    expect(buildTap(pot, at(2, 1), g)).toMatchObject({ do: "put_on" });
    expect(buildTap(pot, at(3, 1), g)).toMatchObject({ do: "taken", block: "kitchen" });
    expect(buildTap(pot, at(4, 1), g)).toMatchObject({ do: "place" });
  });

  it("sets the hearth only on an open tile", () => {
    const hearth: BuildPick = { kind: "hearth" };
    expect(buildTap(hearth, at(1, 1), ground({}))).toMatchObject({ do: "set_hearth" });
    const g = ground({ blocks: { "1,1": "wood" } });
    expect(buildTap(hearth, at(1, 1), g)).toMatchObject({ do: "taken" });
  });
});

describe("the tile an action on a line names", () => {
  it("is whichever of its two tiles is nearer you, with the side that faces the other", () => {
    const line = { x: 5, y: 5, side: "n" } as const;
    expect(lineFrom(line, { x: 5, y: 1 })).toEqual({ x: 5, y: 4, side: "s" });
    expect(lineFrom(line, { x: 5, y: 9 })).toEqual({ x: 5, y: 5, side: "n" });
    expect(lineFrom({ x: 5, y: 5, side: "w" }, { x: 1, y: 5 })).toEqual({ x: 4, y: 5, side: "e" });
    const tap = buildTap(wood, at(5, 4.6), ground({}));
    expect(tileActedOn(tap, { x: 5, y: 1 })).toEqual({ x: 5, y: 4 });
  });
});
