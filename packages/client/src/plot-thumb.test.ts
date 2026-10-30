import type { WorldSnapshot } from "@terrakin/protocol";
import { BLOCK_COLORS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { plotMarks } from "./plot-thumb";

/** Ivy, online and standing on her own hearth. */
const IVY: WorldSnapshot["residents"][number] = {
  id: "ivy",
  name: "Ivy",
  kind: "human",
  color: "sun",
  shape: "round",
  note: "",
  x: 5,
  y: 1,
  online: true,
  hearth: { x: 5, y: 1 },
  theme: "lemon",
};

/** Plots of 4 tiles. Ivy lives on plot (1, 0), tiles x 4 to 7 and y 0 to 3, with a lemon theme. */
const world: WorldSnapshot = {
  v: 1,
  seq: 9,
  hash: "0",
  time: { nowMs: 0, dayLengthMs: 600_000 },
  season: "winter",
  weather: "clear",
  timeOfDay: "night",
  townHall: [],
  day: 20_000,
  config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
  commons: { px: 1, py: 1 },
  residents: [IVY],
  plots: [{ px: 1, py: 0, ownerId: "ivy" }],
  blocks: [
    { x: 4, y: 0, block: "stone" },
    { x: 6, y: 3, block: "lantern" },
    // Someone else's, on the plot to the west: not drawn.
    { x: 3, y: 0, block: "wood" },
  ],
  crops: [{ x: 7, y: 2, crop: "flower", plantedDay: 19_998, readyDay: 20_000 }],
  ground: [{ x: 5, y: 3, ground: "cobble" }],
};

describe("a plot's drawing", () => {
  it("puts what's on the plot at its own tiles, in the world's colors, and nothing from next door", () => {
    const { size, tint, marks } = plotMarks(world, 1, 0);
    expect(size).toBe(4);
    expect(marks.filter((m) => m.kind === "ground")).toHaveLength(16);
    expect(marks.filter((m) => m.kind !== "ground")).toEqual([
      { x: 1, y: 3, kind: "path", ground: "cobble" },
      // Stone takes the lemon theme's finish; the shop's lantern keeps its own color.
      expect.objectContaining({ x: 0, y: 0, kind: "block", glass: false, decor: false }),
      { x: 2, y: 3, kind: "block", fill: BLOCK_COLORS.lantern, glass: false, decor: true },
      expect.objectContaining({ x: 3, y: 2, kind: "crop", ripe: true }),
      { x: 1, y: 1, kind: "hearth" },
      // Ivy is online and standing on her own hearth, so the card shows someone is here.
      { x: 1, y: 1, kind: "here" },
    ]);
    const stone = marks.find((m) => m.kind === "block" && m.x === 0);
    expect(stone && "fill" in stone ? stone.fill : "").not.toBe(BLOCK_COLORS.stone);
    expect(tint).toMatch(/^rgba\(/);
    // The plot next door has its own block and none of Ivy's.
    expect(plotMarks(world, 0, 0).marks.filter((m) => m.kind !== "ground")).toEqual([
      expect.objectContaining({ x: 3, y: 0, kind: "block", fill: BLOCK_COLORS.wood }),
    ]);
  });

  it("draws a home from above: flooring upstairs over the hearth and the crops under it", () => {
    const loft: WorldSnapshot = {
      ...world,
      plots: [{ px: 1, py: 0, ownerId: "ivy", floors: 1 }],
      blocks: [...world.blocks, { x: 4, y: 1, floor: 1, block: "glass" }],
      ground: [...(world.ground ?? []), { x: 5, y: 1, floor: 1, ground: "planks" }],
    };
    const drawn = plotMarks(loft, 1, 0).marks.filter((m) => m.kind !== "ground");
    expect(drawn.slice(-4)).toEqual([
      { x: 1, y: 1, kind: "hearth" },
      { x: 1, y: 1, kind: "path", ground: "planks" },
      expect.objectContaining({ x: 0, y: 1, kind: "block", glass: true }),
      // Whoever is standing there comes after the upstairs, so flooring never covers them.
      { x: 1, y: 1, kind: "here" },
    ]);
  });

  it("draws walls between tiles on their floor, and roofs a home walled only by them (RFC 0050)", () => {
    // Plots of 6 tiles, so plot (1, 0) is x 6 to 11: a 3 by 3 room of lines round x 7 to 9,
    // y 1 to 3, with a door on the south.
    const edges: NonNullable<WorldSnapshot["edges"]> = [];
    for (const i of [7, 8, 9]) {
      edges.push({ x: i, y: 1, side: "n", block: "wood" });
      edges.push({ x: i, y: 4, side: "n", block: i === 8 ? "door" : "wood" });
    }
    for (const j of [1, 2, 3]) {
      edges.push({ x: 7, y: j, side: "w", block: "wood" });
      edges.push({ x: 10, y: j, side: "w", block: "wood" });
    }
    const lined: WorldSnapshot = {
      ...world,
      config: { ...world.config, width: 18, height: 18, plotSize: 6 },
      residents: [],
      crops: [],
      ground: [],
      blocks: [],
      plots: [{ px: 1, py: 0, ownerId: "ivy", roof: { style: "gable", material: "wood" } }],
      // One upstairs, and one on the plot next door.
      edges: [
        ...edges,
        { x: 8, y: 2, side: "w", floor: 1, block: "wood" },
        { x: 5, y: 1, side: "n", block: "stone" },
      ],
    };
    const drawn = plotMarks(lined, 1, 0).marks.filter((m) => m.kind === "edge");
    expect(drawn).toHaveLength(13);
    expect(drawn).toContainEqual({ x: 2, y: 4, kind: "edge", side: "n", block: "door" });
    // The upstairs line comes after the ground floor's, and next door's isn't drawn.
    expect(drawn.at(-1)).toEqual({ x: 2, y: 2, kind: "edge", side: "w", block: "wood" });
    expect(drawn.some((m) => m.x < 0)).toBe(false);
    // The roof covers the room the lines close, as the map's does.
    const roof = plotMarks(lined, 1, 0, { roof: true }).marks.filter((m) => m.kind === "roof");
    expect(roof.map((m) => `${m.x},${m.y}`)).toContain("2,2");
  });

  it("draws whoever is standing there now, once a tile, and nobody who is away (RFC 0020)", () => {
    const sam = { ...IVY, id: "sam", name: "Sam", x: 7, y: 0 };
    const here = (residents: WorldSnapshot["residents"]) =>
      plotMarks({ ...world, residents }, 1, 0)
        .marks.filter((m) => m.kind === "here")
        .map((m) => `${m.x},${m.y}`);
    // Ivy on her hearth and Sam at the plot's north-east corner.
    expect(here([IVY, sam])).toEqual(["1,1", "3,0"]);
    // Two on one tile are one mark, and someone away is drawn asleep rather than standing.
    expect(here([IVY, { ...sam, x: 5, y: 1 }])).toEqual(["1,1"]);
    expect(here([{ ...IVY, online: false }, sam])).toEqual(["3,0"]);
    // Nobody from the plot next door.
    expect(here([{ ...sam, x: 3, y: 0 }])).toEqual([]);
  });

  it("puts the roof over the home, last of all, from the sim's own shape (RFC 0041)", () => {
    // Four walls across the plot's north-west, and a gable of wood over them.
    const walls: WorldSnapshot["blocks"] = [];
    for (let x = 4; x <= 6; x++) {
      for (let y = 0; y <= 2; y++) {
        if (x === 5 && y === 1) continue;
        walls.push({ x, y, block: "wood" });
      }
    }
    const roofed: WorldSnapshot = {
      ...world,
      residents: [],
      crops: [],
      ground: [],
      plots: [{ px: 1, py: 0, ownerId: "ivy", roof: { style: "gable", material: "wood" } }],
      blocks: walls,
    };
    const marks = plotMarks(roofed, 1, 0, { roof: true }).marks.filter((m) => m.kind !== "ground");
    const roof = marks.filter((m) => m.kind === "roof");
    // The box around the walls, nine tiles, and every one of them after the blocks.
    expect(roof).toHaveLength(9);
    expect(marks.slice(-9)).toEqual(roof);
    expect(roof.map((m) => `${m.x},${m.y}`)).toContain("1,1");
    // The ridge runs through the middle row, so it stands higher than the eaves.
    const at = (x: number, y: number) => roof.find((m) => m.x === x && m.y === y);
    expect((at(1, 1)?.high ?? 0) > (at(1, 0)?.high ?? 0)).toBe(true);
    // A plot with no roof set gets none, however its walls stand.
    expect(
      plotMarks({ ...roofed, plots: [{ px: 1, py: 0, ownerId: "ivy" }] }, 1, 0, {
        roof: true,
      }).marks.filter((m) => m.kind === "roof"),
    ).toEqual([]);
  });

  it("lets winter's snow lie on a neighbor's roof (RFC 0041)", () => {
    // A roof wears the season the ground wears (the sim's `roofTone`), so a winter town reads as
    // snowed-over homes rather than summer-colored boxes on white ground.
    const walls: WorldSnapshot["blocks"] = [];
    for (let x = 4; x <= 6; x++) {
      for (let y = 0; y <= 2; y++) walls.push({ x, y, block: "wood" });
    }
    const roofed: WorldSnapshot = {
      ...world,
      residents: [],
      crops: [],
      ground: [],
      plots: [{ px: 1, py: 0, ownerId: "ivy", roof: { style: "gable", material: "wood" } }],
      blocks: walls,
    };
    const fillIn = (season: WorldSnapshot["season"]) => {
      const mark = plotMarks({ ...roofed, season }, 1, 0, { roof: true }).marks.find(
        (m) => m.kind === "roof",
      );
      if (mark?.kind !== "roof") throw new Error("no roof drawn");
      return mark.fill;
    };
    const lightness = (hex: string) =>
      [1, 3, 5].reduce((sum, at) => sum + Number.parseInt(hex.slice(at, at + 2), 16), 0);

    // The fixture's world is already in winter, so the plain covering is what summer draws.
    expect(fillIn("winter")).not.toBe(fillIn("summer"));
    expect(lightness(fillIn("winter"))).toBeGreaterThan(lightness(fillIn("summer")));
    // Autumn warms the ground but leaves roofs alone: only winter lies on them.
    expect(fillIn("autumn")).toBe(fillIn("summer"));
  });

  it("leaves the roof off the plot the drawing is about, so the home shows (RFC 0041)", () => {
    // The same home as above. A card on the Visit page, the home wall, or a profile is a picture
    // of this plot, so its roof lifts the way the map lifts the one you stand on: with it on, an
    // opaque quadrilateral is the whole card, walls, hearth and garden gone (decision 0331).
    const walls: WorldSnapshot["blocks"] = [];
    for (let x = 4; x <= 6; x++) {
      for (let y = 0; y <= 2; y++) {
        if (x === 5 && y === 1) continue;
        walls.push({ x, y, block: "wood" });
      }
    }
    const roofed: WorldSnapshot = {
      ...world,
      residents: [],
      crops: [],
      ground: [],
      plots: [{ px: 1, py: 0, ownerId: "ivy", roof: { style: "gable", material: "wood" } }],
      blocks: walls,
    };
    const marks = plotMarks(roofed, 1, 0).marks;
    expect(marks.filter((m) => m.kind === "roof")).toEqual([]);
    // The walls it would have covered are still drawn.
    expect(marks.filter((m) => m.kind === "block")).toHaveLength(walls.length);
  });
});
