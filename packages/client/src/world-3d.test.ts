import type { BlockKind, GroundKind, ResourceKind, WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  approach,
  cameraQuarter,
  chunkSignature,
  dozersAround,
  faceAngle,
  figuresAround,
  groundAnchor,
  groundPoint,
  hearthKeys,
  MAX_FIGURES,
  nearbyLabel,
  plotsAround,
  readChunk,
  tileAtPoint,
  tileOfHit,
  turnBetween,
  turnDir,
  VIEW_RADIUS,
} from "./scene3d/world-layout";
import { lowEnd, offer3d, startMode } from "./world-mode";

const config: WorldConfig = {
  width: 72,
  height: 72,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const at = (id: string, x: number, y: number, online = true) => ({ id, x, y, online });

describe("which plots the 3D world loads", () => {
  it("loads the plots within the view radius of you, up to the edge of the world", () => {
    const plots = plotsAround({ x: 36, y: 36 }, VIEW_RADIUS, config);
    // Tiles 24..48 each way: plots 3..6.
    expect(plots).toHaveLength(16);
    expect(plots[0]).toEqual({ x: 3, y: 3 });
    expect(plots.at(-1)).toEqual({ x: 6, y: 6 });
    // It stops at the edge of the world.
    expect(plotsAround({ x: 1, y: 2 }, VIEW_RADIUS, config)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(plotsAround({ x: 71, y: 71 }, 3, config)).toEqual([{ x: 8, y: 8 }]);
  });
});

describe("who the 3D world draws", () => {
  it("draws you first, then online neighbors nearest first, within the radius", () => {
    const shown = figuresAround(
      [
        at("far", 36 + VIEW_RADIUS + 1, 36),
        at("near", 37, 36),
        at("asleep", 36, 37, false),
        at("mid", 30, 40),
        at("me", 36, 36),
      ],
      { x: 36, y: 36 },
      "me",
    );
    expect(shown.map((r) => r.id)).toEqual(["me", "near", "mid"]);
  });

  it("keeps to the cap, and you stay in it", () => {
    const crowd = Array.from({ length: 40 }, (_, i) => at(`r${i}`, 36 + (i % 5), 36));
    const shown = figuresAround([...crowd, at("me", 50, 50)], { x: 50, y: 50 }, "me", 20);
    expect(shown).toHaveLength(MAX_FIGURES);
    expect(shown[0]?.id).toBe("me");
  });

  it("fills only the places left with residents asleep at home, nearest first", () => {
    const asleep = [
      { r: { id: "far" }, x: 36 + VIEW_RADIUS + 1, y: 36.6 },
      { r: { id: "mid" }, x: 30, y: 40.6 },
      { r: { id: "near" }, x: 37.72, y: 36 },
    ];
    const focus = { x: 36, y: 36 };
    expect(dozersAround(asleep, focus, 5).map((d) => d.r.id)).toEqual(["near", "mid"]);
    expect(dozersAround(asleep, focus, 1).map((d) => d.r.id)).toEqual(["near"]);
    expect(dozersAround(asleep, focus, 0)).toEqual([]);
  });
});

describe("one plot of the world, read from the mirror", () => {
  const source = (
    blocks: [string, BlockKind][],
    owner?: string,
    lying: ReadonlyMap<string, ResourceKind> = new Map(),
  ) => ({
    config,
    commons: { px: 4, py: 4 },
    blocks: new Map(blocks),
    plots: new Map(owner ? [["1,1", owner]] : []),
    pickupAt: (x: number, y: number) => lying.get(`${x},${y}`) ?? null,
  });

  it("holds the plot's blocks, hearths, and owner, and no grass under them", () => {
    const hearths = hearthKeys([{ hearth: { x: 9, y: 9 } }, { hearth: null }]);
    const chunk = readChunk(source([["8,8", "wood"]], "capri"), 1, 1, hearths);
    expect(chunk.owner).toBe("capri");
    expect(chunk.bounds).toEqual({ x0: 8, y0: 8, x1: 15, y1: 15 });
    expect(chunk.blocks).toEqual([{ x: 8, y: 8, block: "wood" }]);
    expect(chunk.hearths).toEqual([{ x: 9, y: 9 }]);
    for (const t of [...chunk.tufts, ...chunk.flowers]) {
      expect(tileAtPoint(t.x, t.y)).not.toEqual({ x: 8, y: 8 });
      expect(tileAtPoint(t.x, t.y)).not.toEqual({ x: 9, y: 9 });
    }
  });

  it("dresses its ground for the season, and is built again when the season turns", () => {
    const none = new Set<string>();
    const summer = readChunk(source([]), 1, 1, none, "summer");
    const autumn = readChunk(source([]), 1, 1, none, "autumn");
    expect(summer.leaves).toEqual([]);
    expect(autumn.leaves.length).toBeGreaterThan(0);
    expect(autumn.flowers).toEqual([]);
    expect(readChunk(source([]), 1, 1, none, "winter").flowers).toEqual([]);
    expect(chunkSignature(source([]), 1, 1, none, "autumn")).toBe(autumn.signature);
    expect(autumn.signature).not.toBe(summer.signature);
  });

  it("changes its signature exactly when what's drawn changes", () => {
    const none = new Set<string>();
    const a = readChunk(source([["8,8", "wood"]]), 1, 1, none).signature;
    expect(chunkSignature(source([["8,8", "wood"]]), 1, 1, none)).toBe(a);
    expect(chunkSignature(source([["8,8", "stone"]]), 1, 1, none)).not.toBe(a);
    expect(chunkSignature(source([["8,8", "wood"]], "capri"), 1, 1, none)).not.toBe(a);
    // A path laid, or swapped for another, changes it; its tile grows no grass in 3D.
    const paved = (ground: GroundKind) => ({
      ...source([["8,8", "wood"]]),
      paving: new Map<string, GroundKind>([["10,10", ground]]),
    });
    const path = readChunk(paved("cobble"), 1, 1, none);
    expect(path.ground).toEqual([{ x: 10, y: 10, ground: "cobble" }]);
    expect(path.signature).not.toBe(a);
    expect(chunkSignature(paved("planks"), 1, 1, none)).not.toBe(path.signature);
    for (const t of [...path.tufts, ...path.flowers]) {
      expect(tileAtPoint(t.x, t.y)).not.toEqual({ x: 10, y: 10 });
    }
    // A branch on the ground shows, and so does someone picking it up.
    const branch = new Map<string, ResourceKind>([["10,10", "wood"]]);
    const lying = readChunk(source([["8,8", "wood"]], undefined, branch), 1, 1, none);
    expect(lying.pickups).toEqual([{ x: 10, y: 10, kind: "wood" }]);
    expect(lying.signature).not.toBe(a);
    expect(chunkSignature(source([["8,8", "wood"]], undefined, branch), 1, 1, none)).toBe(
      lying.signature,
    );
    // Something put on display, a crop planted, and a crop growing a day all change it.
    const shows = {
      ...source([["8,8", "pedestal"]]),
      displays: new Map([["8,8", { good: { id: "g1", kind: "lemon_jam" as const } }]]),
    };
    const bare = chunkSignature(source([["8,8", "pedestal"]]), 1, 1, none);
    expect(chunkSignature(shows, 1, 1, none)).not.toBe(bare);
    const planted = (day: number) => ({
      ...source([["9,9", "planter"]]),
      crops: new Map([["9,9", { crop: "herb" as const, plantedDay: 1, readyDay: 3 }]]),
      day,
    });
    expect(chunkSignature(planted(1), 1, 1, none)).not.toBe(
      chunkSignature(source([["9,9", "planter"]]), 1, 1, none),
    );
    expect(chunkSignature(planted(2), 1, 1, none)).not.toBe(chunkSignature(planted(1), 1, 1, none));
    expect(chunkSignature(planted(2), 1, 1, none)).toBe(
      readChunk(planted(2), 1, 1, none).signature,
    );
    expect(readChunk(shows, 1, 1, none).displays).toEqual([
      { x: 8, y: 8, on: "pedestal", good: { id: "g1", kind: "lemon_jam" } },
    ]);
    expect(readChunk(planted(2), 1, 1, none).crops).toEqual([
      { x: 9, y: 9, crop: "herb", done: 0.5 },
    ]);
    // A block on another plot doesn't touch this one.
    expect(
      chunkSignature(
        source([
          ["8,8", "wood"],
          ["30,30", "leaf"],
        ]),
        1,
        1,
        none,
      ),
    ).toBe(a);
  });

  it("is built again when someone comes home only if it has windows to light", () => {
    const none = new Set<string>();
    const hut = source([
      ["8,8", "wood"],
      ["9,8", "glass"],
    ]);
    const dark = readChunk(hut, 1, 1, none, undefined, false);
    const lit = readChunk(hut, 1, 1, none, undefined, true);
    expect([dark.lit, lit.lit]).toEqual([false, true]);
    expect(lit.signature).not.toBe(dark.signature);
    expect(chunkSignature(hut, 1, 1, none, undefined, true)).toBe(lit.signature);
    // No glass: nothing to light, nothing to build again.
    const shed = source([["8,8", "wood"]]);
    expect(chunkSignature(shed, 1, 1, none, undefined, true)).toBe(
      chunkSignature(shed, 1, 1, none, undefined, false),
    );
  });

  it("shows a loft whole from off the plot, and cut away at your floor on it (RFC 0028)", () => {
    const none = new Set<string>();
    // A hut on plot (1, 1) with a planked loft and a window upstairs, as the mirror keeps them.
    const loft = {
      ...source([
        ["8,8", "wood"],
        ["9,8", "stairs"],
      ]),
      upstairs: new Map([
        [
          1,
          {
            blocks: new Map<string, BlockKind>([["8,9", "glass"]]),
            paving: new Map<string, GroundKind>([
              ["8,8", "planks"],
              ["8,9", "planks"],
            ]),
          },
        ],
      ]),
    };
    const at = (c: { blocks: { x: number; y: number; floor?: number }[] }) =>
      c.blocks.map((b) => `${b.x},${b.y},${b.floor ?? 0}`);
    const whole = readChunk(loft, 1, 1, none);
    expect(at(whole)).toEqual(["8,8,0", "9,8,0", "8,9,1"]);
    expect(whole.ground.map((g) => g.floor)).toEqual([1, 1]);
    expect(whole.highest).toBe(1);
    // Upstairs where you stand: the same as from above.
    expect(readChunk(loft, 1, 1, none, undefined, false, 1).signature).toBe(whole.signature);
    // On the ground floor of it: nothing above you, but the loft is still counted as there.
    const cut = readChunk(loft, 1, 1, none, undefined, false, 0);
    expect(at(cut)).toEqual(["8,8,0", "9,8,0"]);
    expect(cut.ground).toEqual([]);
    expect(cut.highest).toBe(1);
    // A plot is built again when the cut moves onto it or off it, and only one with a floor.
    expect(cut.signature).not.toBe(whole.signature);
    expect(chunkSignature(loft, 1, 1, none, undefined, false, 0)).toBe(cut.signature);
    const flat = source([["8,8", "wood"]]);
    expect(chunkSignature(flat, 1, 1, none, undefined, false, 0)).toBe(
      chunkSignature(flat, 1, 1, none),
    );
    // A loft on the plot next door is nothing to this one.
    expect(readChunk(loft, 2, 1, none).highest).toBe(0);
  });
});

describe("picking a tile from a tap", () => {
  it("follows a ray down to the ground, and finds none looking up or level", () => {
    const hit = groundPoint([10, 10, 20], [0, -1, -1]);
    expect(hit).toEqual([10, 0, 10]);
    expect(tileAtPoint(10.4, 9.6)).toEqual({ x: 10, y: 10 });
    expect(tileAtPoint(10.6, 9.4)).toEqual({ x: 11, y: 9 });
    // A ray looking up or level finds no ground.
    expect(groundPoint([0, 5, 0], [0, 1, -1])).toBeUndefined();
    expect(groundPoint([0, 5, 0], [0, 0, -1])).toBeUndefined();
  });

  it("puts a tap on a wall's face on the wall's own tile", () => {
    // The south face of the block on (10, 10) is at z = 10.48, seen from the south.
    expect(tileOfHit([10, 0.6, 10.48], [0, -0.6, -1])).toEqual({ x: 10, y: 10 });
    // The top of the same block, seen from above.
    expect(tileOfHit([10.2, 1.25, 10.3], [0, -1, -1])).toEqual({ x: 10, y: 10 });
  });
});

describe("motion in the 3D world", () => {
  it("turns figures the way they last walked, south facing the camera", () => {
    expect(faceAngle("s")).toBe(0);
    expect(faceAngle(undefined)).toBe(0);
    expect(faceAngle("e")).toBeCloseTo(Math.PI / 2);
    expect(faceAngle("n")).toBeCloseTo(Math.PI);
    expect(faceAngle("w")).toBeCloseTo(-Math.PI / 2);
    // Diagonals face halfway between.
    expect(faceAngle("se")).toBeCloseTo(Math.PI / 4);
    expect(faceAngle("ne")).toBeCloseTo((3 * Math.PI) / 4);
    expect(faceAngle("nw")).toBeCloseTo((-3 * Math.PI) / 4);
    expect(faceAngle("sw")).toBeCloseTo(-Math.PI / 4);
  });

  it("snaps away-from-the-camera to the nearest direction, clockwise on a tie", () => {
    // The camera starts south of you, looking north.
    expect(cameraQuarter(0, 12)).toBe(0);
    expect(cameraQuarter(12, 0)).toBe(3); // east of you, looking west
    expect(cameraQuarter(0, -12)).toBe(2); // north of you, looking south
    expect(cameraQuarter(-12, 0)).toBe(1); // west of you, looking east
    // Exactly 45 degrees off goes clockwise: NE is east, SE south, SW west, NW north.
    expect(cameraQuarter(-1, 1)).toBe(1);
    expect(cameraQuarter(-1, -1)).toBe(2);
    expect(cameraQuarter(1, -1)).toBe(3);
    expect(cameraQuarter(1, 1)).toBe(0);
    // Just either side of a boundary.
    expect(cameraQuarter(-0.999, 1)).toBe(0);
    expect(cameraQuarter(-1.001, 1)).toBe(1);
    expect(cameraQuarter(0.999, 1)).toBe(0);
    expect(cameraQuarter(1.001, 1)).toBe(3);
    // Right where the camera sits on the target, up stays north.
    expect(cameraQuarter(0, 0)).toBe(0);
  });

  it("turns the d-pad's directions by the camera's quarter", () => {
    const pad = ["n", "e", "s", "w"] as const;
    expect(pad.map((d) => turnDir(d, 0))).toEqual(["n", "e", "s", "w"]);
    // Looking east: up walks east, right walks south, down west, left north.
    expect(pad.map((d) => turnDir(d, 1))).toEqual(["e", "s", "w", "n"]);
    expect(pad.map((d) => turnDir(d, 2))).toEqual(["s", "w", "n", "e"]);
    expect(pad.map((d) => turnDir(d, 3))).toEqual(["w", "n", "e", "s"]);
    // Diagonals turn with them: up and right together walks south-east when looking east.
    const corners = ["ne", "se", "sw", "nw"] as const;
    expect(corners.map((d) => turnDir(d, 1))).toEqual(["se", "sw", "nw", "ne"]);
    expect(corners.map((d) => turnDir(d, 2))).toEqual(["sw", "nw", "ne", "se"]);
  });

  it("turns the short way round", () => {
    expect(turnBetween(Math.PI, -Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(turnBetween(-Math.PI / 2, Math.PI)).toBeCloseTo(-Math.PI / 2);
    expect(turnBetween(0.1, 0.1)).toBe(0);
  });

  it("glides toward a target at the same pace whatever the frame rate, and lands", () => {
    const once = approach(0, 1, 0.1, 12);
    let twice = approach(0, 1, 0.05, 12);
    twice = approach(twice, 1, 0.05, 12);
    expect(twice).toBeCloseTo(once, 10);
    let x = 0;
    for (let i = 0; i < 120; i++) x = approach(x, 1, 1 / 60, 12);
    expect(x).toBe(1);
  });

  it("moves the ground only in steps", () => {
    expect(groundAnchor({ x: 37, y: 34 })).toEqual({ x: 36, y: 36 });
    expect(groundAnchor({ x: 38, y: 33 })).toEqual({ x: 40, y: 32 });
  });
});

describe("the 3D view's label", () => {
  it("names a few neighbors and counts the rest", () => {
    expect(nearbyLabel([])).toBe("World view in 3D");
    expect(nearbyLabel(["Wren", "Moss"])).toBe("World view in 3D. Nearby: Wren, Moss");
    expect(nearbyLabel(["a", "b", "c", "d", "e", "f"])).toBe(
      "World view in 3D. Nearby: a, b, c, d, and 2 more",
    );
  });
});

describe("when the world offers 3D", () => {
  const phone = { webgl2: true, memoryGb: 4, cores: 6 };

  it("offers it with WebGL 2 on a device that isn't low end: little memory, few cores, or Save-Data", () => {
    expect(offer3d(phone)).toBe(true);
    expect(offer3d({ webgl2: true })).toBe(true);
    expect(offer3d({ ...phone, webgl2: false })).toBe(false);
    expect(lowEnd(phone)).toBe(false);
    expect(lowEnd({ ...phone, memoryGb: 2 })).toBe(true);
    expect(lowEnd({ ...phone, cores: 2 })).toBe(true);
    expect(lowEnd({ ...phone, saveData: true })).toBe(true);
    expect(offer3d({ ...phone, memoryGb: 2 })).toBe(false);
  });

  it("opens in 2D unless you picked 3D here and it's still offered", () => {
    expect(startMode(null, phone)).toBe("2d");
    expect(startMode("2d", phone)).toBe("2d");
    expect(startMode("3d", phone)).toBe("3d");
    expect(startMode("3d", { ...phone, saveData: true })).toBe("2d");
    expect(startMode("nonsense", phone)).toBe("2d");
  });
});
