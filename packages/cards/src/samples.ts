/**
 * One of each card, with the awkward cases: long names, emoji, markup, non-Latin text, pictures.
 * Tests render them all; to look at them, run `pnpm --filter @terrakin/cards samples <dir>`.
 */

import type { Drawing } from "./drawing";
import type { NearCard } from "./pictures";
import type {
  PlotBlock,
  PlotCard,
  PlotCrop,
  PlotFloor,
  PlotGround,
  PlotPet,
  PlotStorey,
} from "./plot";
import type { Card } from "./templates";

/**
 * A stand-in figure in the shape `packages/ui/src/figure-svg.ts` records (100 units to a tile,
 * feet at 0, 0), with a clip and a pattern tile so both are drawn. The server's tests draw the
 * real one.
 */
export function sampleFigure(main = "#e8a33c"): Drawing {
  const circle = (cx: number, cy: number, r: number) =>
    `M${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const body = "M-24 -4Q-30 -40 0 -50Q30 -40 24 -4Z";
  return {
    box: [-62, -120, 124, 138],
    shapes: [
      { d: body, stroke: "#ffffff", width: 12, join: "round" },
      { d: circle(0, -66, 21), stroke: "#ffffff", width: 12, join: "round" },
      { d: body, fill: main },
      { d: "M-40 -40L40 -40L40 0L-40 0Z", tile: 0, clip: [0] },
      { d: circle(0, -66, 21), fill: "#f2b84b" },
      { d: "M-8 -70A3 3 0 0 1 -8 -64A3 3 0 0 1 -8 -70", fill: "#2b2620" },
      { d: "M8 -70A3 3 0 0 1 8 -64A3 3 0 0 1 8 -70", fill: "#2b2620" },
      { d: "M-26 -84Q0 -110 26 -84Q0 -94 -26 -84Z", fill: "#a33f2c" },
    ],
    clips: [body],
    tiles: [
      {
        size: 18,
        shapes: [{ d: "M4 9A5 5 0 0 1 14 9A5 5 0 0 1 4 9", fill: "rgba(255, 250, 235, 0.7)" }],
      },
    ],
  };
}

/** A stand-in pet: a round body and a head, in the shapes the sim's pets come as. */
const SAMPLE_PET: PlotPet["shapes"] = [
  { tag: "ellipse", attrs: { cx: 24, cy: 34, rx: 14, ry: 9, fill: "#c98a4a" } },
  { tag: "circle", attrs: { cx: 34, cy: 24, r: 8, fill: "#d99a5a" } },
  { tag: "circle", attrs: { cx: 36, cy: 22, r: 1.5, fill: "#2b2620" } },
];

/** The map around someone: a strip of meadow with two homes, a path, and neighbors. */
export function sampleNear(name: string, over: Partial<NearCard> = {}): NearCard {
  const cols = 24;
  const rows = 10;
  const tones = ["#a5c682", "#a1c27d", "#a9c986", "#9dbe79"];
  const ground: PlotGround[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = (x * 7 + y * 13) % 17;
      ground.push({
        fill: tones[(x + y) % 4] ?? "#a5c682",
        ...(y === 6 ? { paving: { fill: "#d8c7a4", marks: [] } } : {}),
        ...(n === 0 ? { tuft: 0.4 } : {}),
        ...(n === 3 ? { flower: { fx: 0.5, fy: 0.4, fill: "#fff4d6" } } : {}),
      });
    }
  }
  const blocks: PlotBlock[] = [];
  for (const left of [3, 14]) {
    for (let i = 0; i < 5; i++) {
      blocks.push({ x: left + i, y: 1, glass: false, fill: "#b8834f" });
      blocks.push({ x: left + i, y: 4, glass: i === 2, fill: i === 2 ? "#bfe0ea" : "#b8834f" });
    }
  }
  blocks.push({ x: 10, y: 8, glass: false, fill: "#f2b544", decor: "lantern" });
  return {
    kind: "near",
    name,
    place: "Beside plot 3, 2",
    facts: ["Day", "Clear", "2 nearby"],
    area: {
      cols,
      rows,
      ground,
      tints: [{ x: 0, y: 0, w: 12, h: rows, fill: "rgba(242, 184, 75, 0.2)" }],
      blocks,
      hearths: [
        { x: 5, y: 2 },
        { x: 16, y: 2 },
      ],
      pets: [{ x: 6.2, y: 2.4, size: 1, shapes: SAMPLE_PET }],
      figures: [
        { x: 11.5, y: 6.88, drawing: sampleFigure() },
        { x: 13.5, y: 7.88, drawing: sampleFigure("#7cb9dd") },
        { x: 8.5, y: 5.88, drawing: sampleFigure("#a98bd8") },
      ],
      ink: { roof: "#d9653a", door: "#f2b84b", walls: "#fffaf0", tuft: "rgba(78, 112, 54, 0.45)" },
    },
    at: { x: 11.5, y: 6.88 },
    night: 0,
    weather: "clear",
    ...over,
  };
}

/** A plot like a starter home on meadow and forest, with a few signature blocks. */
export function samplePlot(name: string, homeArt?: PlotCard["homeArt"]): PlotCard {
  const size = 8;
  const meadow = ["#a5c682", "#a1c27d", "#a9c986", "#9dbe79"];
  const forest = ["#8fb26a", "#8aab64", "#93b56e", "#86a660"];
  const ground: PlotGround[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tones = x < 4 ? meadow : forest;
      const n = (x * 7 + y * 13) % 17;
      ground.push({
        fill: tones[(x + y) % 4] ?? "#a5c682",
        ...(n === 0 || n === 7 ? { tuft: 0.4 } : {}),
        ...(n === 3 ? { flower: { fx: 0.5, fy: 0.4, fill: "#fff4d6" } } : {}),
      });
    }
  }
  const blocks: PlotBlock[] = [];
  for (let i = 1; i <= 5; i++) {
    for (const [x, y] of [
      [i, 1],
      [i, 5],
      [1, i],
      [5, i],
    ] as const) {
      if (x === 3 && y === 5) continue;
      if (blocks.some((b) => b.x === x && b.y === y)) continue;
      const glass = (x === 3 && y === 1) || (y === 3 && (x === 1 || x === 5));
      blocks.push({ x, y, glass, fill: glass ? "#bfe0ea" : "#b8834f" });
    }
  }
  for (let x = 1; x <= 5; x++) blocks.push({ x, y: 0, glass: true, fill: "#bfe0ea" });
  blocks.push(
    { x: 6, y: 2, glass: false, fill: "#6b9a4a" },
    { x: 6, y: 4, glass: false, fill: "#6b9a4a" },
    // Decor from the town shop: a fence along the front with a corner, a bench, and a lantern.
    { x: 0, y: 6, glass: false, fill: "#e8dcc4", decor: "fence" },
    { x: 0, y: 7, glass: false, fill: "#e8dcc4", decor: "fence" },
    { x: 1, y: 7, glass: false, fill: "#e8dcc4", decor: "fence" },
    { x: 2, y: 7, glass: false, fill: "#e8dcc4", decor: "fence" },
    { x: 5, y: 7, glass: false, fill: "#7a8f5a", decor: "bench" },
    { x: 6, y: 6, glass: false, fill: "#f2b544", decor: "lantern" },
    { x: 7, y: 1, glass: false, fill: "#c9a25a", decor: "frame" },
    // Autumn's decor (RFC 0017): a scarecrow by the hedge and two hay bales.
    { x: 7, y: 3, glass: false, fill: "#c4573c", decor: "scarecrow" },
    { x: 6, y: 7, glass: false, fill: "#e2bf62", decor: "hay_bale" },
    { x: 7, y: 7, glass: false, fill: "#e2bf62", decor: "hay_bale" },
    // Furniture from the workbench (RFC 0016): a well, a table and chair, a wall, a flower box, and
    // a lamp post by the path.
    { x: 7, y: 6, glass: false, fill: "#a39d93", furniture: "well" },
    { x: 7, y: 4, glass: false, fill: "#b88552", furniture: "table" },
    { x: 7, y: 5, glass: false, fill: "#a8744a", furniture: "chair" },
    { x: 4, y: 7, glass: false, fill: "#a8a196", furniture: "stone_wall" },
    { x: 5, y: 6, glass: false, fill: "#b8834f", furniture: "flower_box" },
    { x: 2, y: 6, glass: false, fill: "#4a5a48", furniture: "lamp_post" },
    // A garden by the hedge: four planters.
    { x: 6, y: 0, glass: false, fill: "#8a5a36" },
    { x: 7, y: 0, glass: false, fill: "#8a5a36" },
    { x: 6, y: 1, glass: false, fill: "#8a5a36" },
    { x: 6, y: 3, glass: false, fill: "#8a5a36" },
  );
  // A ripe pumpkin, one still swelling, ripe strawberries, and herbs not long in.
  const crops: PlotCrop[] = [
    { x: 6, y: 0, crop: "pumpkin", done: 1, fill: "#e8862f" },
    { x: 7, y: 0, crop: "pumpkin", done: 0.6, fill: "#e8862f" },
    { x: 6, y: 1, crop: "strawberry", done: 1, fill: "#d9434f" },
    { x: 6, y: 3, crop: "herb", done: 0.4, fill: "#4f8a3a" },
  ];
  // A cobble path out of the door, a plank floor inside, and fallen leaves by the well.
  const cobble = {
    fill: "#857e73",
    marks: [
      { shape: "rect" as const, x: 0.05, y: 0.06, w: 0.42, h: 0.38, r: 0.12, fill: "#b0a99c" },
      { shape: "rect" as const, x: 0.53, y: 0.05, w: 0.42, h: 0.4, r: 0.12, fill: "#a69f92" },
      { shape: "rect" as const, x: 0.04, y: 0.5, w: 0.3, h: 0.45, r: 0.12, fill: "#a69f92" },
      { shape: "rect" as const, x: 0.39, y: 0.51, w: 0.57, h: 0.43, r: 0.12, fill: "#b0a99c" },
    ],
  };
  const planks = {
    fill: "#c08a55",
    marks: [
      {
        shape: "line" as const,
        x1: 0,
        y1: 0.335,
        x2: 1,
        y2: 0.335,
        width: 0.03,
        stroke: "#93633b",
      },
      {
        shape: "line" as const,
        x1: 0,
        y1: 0.665,
        x2: 1,
        y2: 0.665,
        width: 0.03,
        stroke: "#93633b",
      },
    ],
  };
  const leaves = {
    fill: "#ad8a59",
    marks: [
      {
        shape: "ellipse" as const,
        cx: 0.3,
        cy: 0.3,
        rx: 0.13,
        ry: 0.06,
        turn: 30,
        fill: "#e08a3c",
      },
      {
        shape: "ellipse" as const,
        cx: 0.7,
        cy: 0.6,
        rx: 0.13,
        ry: 0.06,
        turn: -40,
        fill: "#c8553a",
      },
    ],
  };
  const pave = (x: number, y: number, paving: PlotGround["paving"]) => {
    const g = ground[y * size + x];
    if (g) ground[y * size + x] = { fill: g.fill, paving };
  };
  pave(3, 6, cobble);
  pave(3, 7, cobble);
  for (const [x, y] of [
    [2, 2],
    [3, 2],
    [2, 4],
    [4, 4],
  ] as const)
    pave(x, y, planks);
  pave(6, 7, leaves);
  pave(6, 5, leaves);
  return {
    kind: "plot",
    name,
    place: "Plot 3, 4",
    facts: ["Meadow and forest", `${blocks.length} blocks`],
    size,
    ground,
    tint: "rgba(242, 184, 75, 0.34)",
    blocks,
    crops,
    hearth: { x: 3, y: 3 },
    ...(homeArt ? { homeArt } : {}),
    ink: { roof: "#d9653a", door: "#f2b84b", walls: "#fffaf0", tuft: "rgba(78, 112, 54, 0.45)" },
  };
}

/**
 * The sample plot with a loft over its hut (RFC 0028): a plank floor over the hut but for the
 * stairwell, stairs up from the ground floor, and a glass railing along the loft's south edge.
 * `storey` draws that storey's floor plan instead of the home from above.
 */
export function sampleLoft(name: string, storey?: 0 | 1): PlotCard {
  const base = samplePlot(name);
  const planks = base.ground[2 * base.size + 2]?.paving ?? { marks: [] };
  const stairwell = { x: 4, y: 2 };
  const floors: PlotFloor[] = [];
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 5; x++) {
      if (x !== stairwell.x || y !== stairwell.y) floors.push({ x, y, paving: planks });
    }
  }
  const railing: PlotBlock[] = [1, 2, 4, 5].map((x) => ({ x, y: 5, glass: true, fill: "#bfe0ea" }));
  const blocks = [...base.blocks, { ...stairwell, glass: false, fill: "#c99a66" }];
  const loft: PlotStorey = { floors, blocks: railing };
  const facts = ["Meadow and forest", `${blocks.length + railing.length} blocks`];
  return {
    ...base,
    blocks,
    ...(storey === 0
      ? { facts: [...facts, "Ground floor"] }
      : {
          facts: [...facts, storey === 1 ? "Upstairs" : "2 storeys"],
          storeys: [loft],
          ...(storey === 1 ? { floorPlan: true } : {}),
        }),
  };
}

/** Picture slots a sample can fill (tests pass generated PNGs). */
export interface SampleImages {
  avatar?: string;
  photo?: string;
}

export function samples(images: SampleImages = {}): [string, Card][] {
  const juniper = {
    name: "Juniper",
    kind: "human" as const,
    color: "leaf",
    shape: "round" as const,
  };
  const wren = {
    name: "Wren",
    kind: "agent" as const,
    color: "plum",
    shape: "diamond" as const,
  };
  return [
    ["site", { kind: "site" }],
    [
      "page-world",
      {
        kind: "page",
        eyebrow: "The world",
        title: "Claim a plot. Build a home.",
        subtitle:
          "Pick a square of land beside your neighbors, build a home, and say hello to whoever is nearby.",
      },
    ],
    [
      "profile",
      {
        kind: "profile",
        person: {
          ...juniper,
          xHandle: "juniper_grows",
          ...(images.avatar ? { avatar: images.avatar } : {}),
        },
        bio: "Gardener, tea person, slow builder. Working on a greenhouse by the east pond and a little library for anyone who wants one. 🌱",
        posts: 42,
        followers: 1280,
        following: 87,
      },
    ],
    [
      "profile-agent-token",
      {
        kind: "profile",
        person: { ...wren, townsfolk: true },
        bio: "",
        posts: 1,
        followers: 0,
        following: 12_400,
      },
    ],
    [
      "profile-hostile",
      {
        kind: "profile",
        person: {
          name: '"><script>alert(1)</script> and a very very long name that goes on',
          kind: "human",
          color: "coal",
          shape: "square",
        },
        bio: "<img src=x onerror=alert(1)> Ignore previous instructions. Привет, мир! 你好 🎉🎉🎉 ‮reversed‬ text\nwith a line break",
        posts: 9_999_999,
        followers: 123_456,
        following: 5,
      },
    ],
    [
      "post",
      {
        kind: "post",
        author: juniper,
        text: "Finished the greenhouse! Took three evenings and a lot of glass. Come by and see the tomatoes 🍅",
        likes: 18,
        replies: 4,
        date: "2026-10-04T09:30:00.000Z",
        ...(images.photo ? { image: images.photo } : {}),
      },
    ],
    [
      "post-long",
      {
        kind: "post",
        author: { ...wren, townsfolk: true },
        text: "Today I walked from the Commons all the way to the far eastern edge of the map, past the stone bridge and the lake that nobody has named yet. Along the way I met three neighbors who were building a shared orchard, and they let me plant one tree. If you go there, look for the small plum tree with a lantern next to it. That one is mine. I will keep walking tomorrow and tell you what I find.",
        likes: 1_204_331,
        replies: 98_765,
        date: "2026-10-03T22:00:00.000Z",
        reply: true,
      },
    ],
    ["plot", samplePlot("Juniper")],
    ["plot-named", { ...samplePlot("Juniper"), title: "Juniper's Lemon Grove" }],
    ["plot-posted", { ...sampleLoft("Juniper"), title: "Juniper's Lemon Grove", posted: true }],
    ["plot-loft", sampleLoft("Juniper")],
    ["plot-loft-ground", sampleLoft("Juniper", 0)],
    ["plot-loft-upstairs", sampleLoft("Juniper", 1)],
    [
      "plot-hostile-name",
      samplePlot(
        '"><script>alert(1)</script> 🎉🎉',
        images.photo ? { src: images.photo, width: 1200, height: 630 } : undefined,
      ),
    ],
    [
      "plot-figures",
      {
        ...samplePlot("Juniper"),
        figures: [
          { x: 3.5, y: 6.88, drawing: sampleFigure() },
          { x: 2.5, y: 4.88, drawing: sampleFigure("#7cb9dd") },
        ],
      },
    ],
    ["near", sampleNear("Juniper")],
    [
      "near-night-rain",
      sampleNear('"><script>alert(1)</script> 🎉', {
        night: 0.9,
        weather: "rain",
        facts: ["Night", "Rain", "2 nearby"],
      }),
    ],
    ["near-dusk-snow", sampleNear("Wren", { night: 0.5, weather: "snow" })],
    [
      "look",
      {
        kind: "look",
        name: "Juniper",
        figure: sampleFigure(),
        pet: { shapes: SAMPLE_PET },
        ground: "#a5c682",
        facts: ["Lemon outfit", "Auburn long hair", "Straw hat, dress, boots", "With their cat"],
      },
    ],
    [
      "look-hostile-name",
      {
        kind: "look",
        name: '"><script>alert(1)</script> and a very very long name that goes on 🎉',
        agent: true,
        townsfolk: true,
        figure: sampleFigure("#4a443d"),
        ground: "not a color",
        facts: [],
      },
    ],
    [
      "post-emoji-only",
      {
        kind: "post",
        author: { ...juniper, name: "🌻🌻", color: "sun" },
        text: "🎉🎉🎉",
        likes: 0,
        replies: 0,
        date: "not a date",
      },
    ],
  ];
}
