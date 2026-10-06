import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldSnapshot } from "@terrakin/protocol";
import {
  BLOCK_KINDS,
  HAIR_COLOR_INFO,
  HAIR_STYLES,
  RESIDENT_COLORS,
  THEME_INFO,
  type WearItem,
} from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { GARMENT_COLOR, garmentColor } from "@terrakin/ui/figure";
import { type BufferGeometry, Color, IcosahedronGeometry, Mesh, SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import { blockColor, RESIDENT_COLOR_HEX } from "./render";
import { parseGallery } from "./scene3d/catalog";
import { hairMesh, hairPieces } from "./scene3d/hair";
import {
  cornerLight,
  distanceOutside,
  FIGURE_SCALE,
  fitModel,
  groundDecor,
  HAT_BAND,
  hearthPull,
  hearthStand,
  homeExtras,
  homePlot,
  mediaRef,
  modelFootprint,
  overBudget,
  plotBounds,
  plotLayout,
  rawResident,
  SIGN_SIZE,
  signSize,
  tagHeight,
  underFootprint,
  wornPieces,
} from "./scene3d/layout";
import { BRAND, blockLook, hex, mix, residentHex, shade } from "./scene3d/palette";
import { faceParts, OVERHEAD_ORDER, overheadMaterial } from "./scene3d/plot";
import { onHead } from "./scene3d/wear";

type ResidentView = WorldSnapshot["residents"][number];

const resident = (over: Partial<ResidentView>): ResidentView => ({
  id: "a",
  name: "Ada",
  kind: "human",
  color: "sun",
  shape: "round",
  note: "",
  x: 0,
  y: 0,
  online: true,
  hearth: null,
  ...over,
});

/** A 32x32 world of 8-tile plots. Capri owns plot (1, 1) (tiles 8..15) with a hut and a hearth. */
function world(): WorldSnapshot {
  return {
    v: 1,
    seq: 1,
    hash: "x",
    config: { width: 32, height: 32, plotSize: 8, maxPlotsPerResident: 2, reach: 3 },
    commons: { px: 2, py: 2 },
    residents: [
      resident({ id: "capri", name: "Capri", x: 3, y: 3, hearth: { x: 11, y: 11 } }),
      resident({ id: "visitor", name: "Wren", kind: "agent", x: 9, y: 14, online: true }),
      resident({ id: "asleep", name: "Moss", x: 10, y: 9, online: false }),
      resident({ id: "far", name: "Pip", x: 30, y: 30 }),
    ],
    plots: [
      { px: 0, py: 0, ownerId: "capri" },
      { px: 1, py: 1, ownerId: "capri" },
      { px: 2, py: 1, ownerId: "bram" },
    ],
    blocks: [
      { x: 10, y: 10, block: "wood" },
      { x: 12, y: 10, block: "glass" },
      { x: 11, y: 12, block: "wood" },
      { x: 16, y: 10, block: "stone" }, // neighbor, 1 tile outside
      { x: 19, y: 10, block: "stone" }, // neighbor, 4 tiles outside
      { x: 21, y: 10, block: "stone" }, // beyond the margin
    ],
  };
}

describe("plot layout", () => {
  it("measures plot bounds and distance outside them", () => {
    const b = plotBounds(8, 1, 1);
    expect(b).toEqual({ x0: 8, y0: 8, x1: 15, y1: 15 });
    expect(distanceOutside(b, 10, 10)).toBe(0);
    expect(distanceOutside(b, 16, 10)).toBe(1);
    expect(distanceOutside(b, 5, 19)).toBe(4);
  });

  it("picks the plot that holds the hearth, else the first one", () => {
    const w = world();
    expect(homePlot(w, "capri")).toEqual({ px: 1, py: 1 });
    const noHearth = { ...w, residents: w.residents.map((r) => ({ ...r, hearth: null })) };
    expect(homePlot(noHearth, "capri")).toEqual({ px: 0, py: 0 });
    expect(homePlot(w, "nobody")).toBeUndefined();
    expect(plotLayout(w, "far")).toBeUndefined();
  });

  it("keeps the plot's blocks, fades neighbors by distance, and drops what's past the margin", () => {
    const layout = plotLayout(world(), "capri", 4);
    if (!layout) throw new Error("no layout");
    expect(layout.center).toEqual({ x: 11.5, y: 11.5 });
    expect(layout.hearth).toEqual({ x: 11, y: 11 });
    const own = layout.blocks.filter((b) => b.own).map((b) => [b.x, b.y, b.block]);
    expect(own).toEqual([
      [10, 10, "wood"],
      [12, 10, "glass"],
      [11, 12, "wood"],
    ]);
    const neighbors = layout.blocks.filter((b) => !b.own);
    expect(neighbors.map((b) => [b.x, b.fade])).toEqual([
      [16, 1 / 5],
      [19, 4 / 5],
    ]);
  });

  it("shows online visitors on the plot and always the owner, standing by the hearth when away", () => {
    const layout = plotLayout(world(), "capri");
    if (!layout) throw new Error("no layout");
    const figures = Object.fromEntries(layout.figures.map((f) => [f.id, f]));
    expect(Object.keys(figures).sort()).toEqual(["capri", "visitor"]);
    expect(figures.visitor).toMatchObject({ x: 9, y: 14, owner: false, kind: "agent" });
    // Capri is out at (3, 3), so she waits east of her hearth, which is free.
    expect(figures.capri).toMatchObject({ x: 12, y: 11, owner: true });
  });

  it("shows what's on display and what grows on the plot, but not on a neighbor's", () => {
    const w = world();
    const good = (id: string, kind: "piece" | "lemon_jam") => ({
      id,
      kind,
      maker: "capri",
      madeDay: 1,
      ...(kind === "piece" ? { media: "m_0123456789abcdef", label: "Sky" } : {}),
    });
    w.day = 12;
    w.blocks.push(
      { x: 9, y: 9, block: "pedestal" },
      { x: 13, y: 9, block: "frame" },
      { x: 14, y: 14, block: "planter" },
      { x: 15, y: 14, block: "planter" },
      { x: 17, y: 9, block: "pedestal" }, // a neighbor's
    );
    w.displays = [
      { x: 9, y: 9, good: good("g1", "piece"), by: "capri", day: 3 },
      { x: 13, y: 9, good: good("g2", "lemon_jam"), by: "capri", day: 3 },
      { x: 17, y: 9, good: good("g3", "lemon_jam"), by: "bram", day: 3 },
      { x: 10, y: 10, good: good("g4", "lemon_jam"), by: "capri", day: 3 }, // not a pedestal
    ];
    w.crops = [
      { x: 14, y: 14, crop: "lemon", plantedDay: 10, readyDay: 14 },
      { x: 15, y: 14, crop: "herb", plantedDay: 8, readyDay: 10 },
      { x: 10, y: 10, crop: "herb", plantedDay: 8, readyDay: 10 }, // not a planter
    ];
    const layout = plotLayout(w, "capri");
    if (!layout) throw new Error("no layout");
    expect(layout.displays).toEqual([
      {
        x: 9,
        y: 9,
        on: "pedestal",
        good: { id: "g1", kind: "piece", media: "m_0123456789abcdef", model: undefined },
      },
      {
        x: 13,
        y: 9,
        on: "frame",
        good: { id: "g2", kind: "lemon_jam", media: undefined, model: undefined },
      },
    ]);
    expect(layout.crops).toEqual([
      { x: 14, y: 14, crop: "lemon", done: 0.5 },
      { x: 15, y: 14, crop: "herb", done: 1 },
    ]);
  });

  it("darkens ground corners next to blocks", () => {
    const solid = new Set(["4,4", "5,4"]);
    expect(cornerLight(solid, 0, 0)).toBe(1);
    expect(cornerLight(solid, 4, 4)).toBeCloseTo(0.9);
    expect(cornerLight(solid, 5, 5)).toBeCloseTo(0.8);
  });

  it("scatters the same grass and flowers every time, never on a block", () => {
    const b = plotBounds(8, 1, 1);
    const solid = new Set<string>();
    const a = groundDecor(b, solid);
    expect(groundDecor(b, solid)).toEqual(a);
    expect(a.tufts.length + a.flowers.length).toBeGreaterThan(0);
    const full = new Set<string>();
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) full.add(`${x},${y}`);
    expect(groundDecor(b, full)).toEqual({ tufts: [], flowers: [] });
  });
});

describe("faces on 3D figures", () => {
  const capriFeels = (online: boolean, time?: { nowMs: number; dayLengthMs: number }) => {
    const w = world();
    w.residents = w.residents.map((r) => (r.id === "capri" ? { ...r, online } : r));
    if (time) w.time = time;
    return plotLayout(w, "capri")?.figures.find((f) => f.id === "capri")?.feeling;
  };

  it("dozes by the hearth after dark while out, and not by day, online, or without a clock", () => {
    const midnight = { nowMs: 75_000, dayLengthMs: 100_000 };
    const noon = { nowMs: 25_000, dayLengthMs: 100_000 };
    expect(capriFeels(false, midnight)).toBe("sleepy");
    expect(capriFeels(false, noon)).toBeUndefined();
    expect(capriFeels(true, midnight)).toBeUndefined();
    expect(capriFeels(false)).toBeUndefined();
  });

  it("adds fewer than 50 triangles over the sphere eyes and cheeks it replaces", () => {
    const triangles = (g: BufferGeometry) =>
      (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
    let face = 0;
    let shownNeutral = 0;
    faceParts().head.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      face += triangles(o.geometry);
      if (o.visible) shownNeutral++;
    });
    // The waving hand and the floating sign (a sprite: two triangles).
    const extra = face + triangles(new IcosahedronGeometry(0.05, 0)) + 2;
    const replaced = 4 * triangles(new SphereGeometry(0.022, 8, 6));
    expect(extra - replaced).toBeLessThan(50);
    // A neutral face draws two eyes and two cheeks, as before.
    expect(shownNeutral).toBe(4);
  });

  it("keeps a feeling's sign readable from the world's camera, at its own size up close", () => {
    // The world's camera starts 17.7 units back through a 58 degree lens on a phone.
    const far = signSize(Math.hypot(13, 12), 58);
    const viewHeight = 2 * Math.hypot(13, 12) * Math.tan((29 * Math.PI) / 180);
    expect((far * FIGURE_SCALE * 844) / viewHeight).toBeGreaterThanOrEqual(28);
    expect(signSize(3, 58)).toBe(SIGN_SIZE);
    expect(signSize(24, 58)).toBeGreaterThan(far);
  });

  it("draws name tags, signs and bubbles over everything, in a fixed order", () => {
    const m = overheadMaterial();
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(OVERHEAD_ORDER.tag).toBeLessThan(OVERHEAD_ORDER.sign);
    expect(OVERHEAD_ORDER.sign).toBeLessThan(OVERHEAD_ORDER.bubble);
  });

  it("stands someone on a hearth's tile clear of the stonework, smoothly as they step on", () => {
    const open =
      (...shut: [number, number][]) =>
      (dx: number, dy: number) =>
        !shut.some(([x, y]) => x === dx && y === dy);
    // In front of the fire, else beside it, else behind.
    expect(hearthStand(open())).toEqual({ x: 0, y: 0.6 });
    expect(hearthStand(open([0, 1]))).toEqual({ x: 0.72, y: 0 });
    expect(hearthStand(open([0, 1], [1, 0]))).toEqual({ x: -0.72, y: 0 });
    expect(hearthStand(open([0, 1], [1, 0], [-1, 0]))).toEqual({ x: 0, y: -0.6 });
    // All the way on the tile, none a tile off, and moving forward the whole slide in.
    expect(hearthPull(5, 5, 5, 5)).toBe(1);
    expect(hearthPull(5, 6, 5, 5)).toBe(0);
    expect(hearthPull(6, 6, 5, 5)).toBe(0);
    const { y: step } = hearthStand(open());
    const drawnAt = (y: number) => y + step * hearthPull(5, y, 5, 5);
    for (let y = 6; y > 5; y -= 0.1) expect(drawnAt(y - 0.1)).toBeLessThan(drawnAt(y));
  });

  it("turns hats, glasses and the bow with the head, and leaves the rest on the body", () => {
    expect(
      ["straw_hat", "beret", "top_hat", "muse_halo", "glasses", "bow"].every((w) =>
        onHead(w as WearItem),
      ),
    ).toBe(true);
    expect(["scarf", "satchel", "umbrella", "boots"].some((w) => onHead(w as WearItem))).toBe(
      false,
    );
  });
});

describe("wear on 3D figures", () => {
  it("comes in slot order, in the colors and patterns the 2D figure uses", () => {
    const pieces = wornPieces({
      color: "sky",
      shape: "round",
      theme: "lemon",
      wear: ["boots", "dress", "straw_hat", "not_a_thing" as never],
      wearStyle: { dress: { pattern: "citrus", color: "sun" } },
    });
    expect(pieces.map((p) => p.item)).toEqual(["straw_hat", "dress", "boots"]);
    const [hat, dress, boots] = pieces;
    expect(hat).toMatchObject({ color: GARMENT_COLOR.straw_hat(THEME_INFO.lemon.palette) });
    expect(hat?.pattern).toBeUndefined();
    expect(dress).toMatchObject({ color: RESIDENT_COLOR_HEX.sun, pattern: "citrus" });
    expect(boots?.color).toBe(garmentColor({ color: "sky", theme: "lemon" }, "boots"));
  });

  it("lifts the name tag over a top hat, a halo, an umbrella, or tall hair", () => {
    const look = (wear: WearItem[]) => ({ color: "sky" as const, shape: "round" as const, wear });
    expect(tagHeight({ kind: "human", look: look([]) })).toBe(1.08);
    expect(tagHeight({ kind: "agent", look: look([]) })).toBe(1.2);
    expect(tagHeight({ kind: "human", look: look(["top_hat"]) })).toBeGreaterThan(1.08);
    expect(tagHeight({ kind: "human", look: look(["muse_halo"]) })).toBeGreaterThan(1.08);
    expect(tagHeight({ kind: "agent", look: look(["umbrella"]) })).toBeGreaterThan(1.2);
    expect(tagHeight({ kind: "human", look: { ...look([]), hair: "afro" } })).toBeGreaterThan(1.08);
    // Short hair, or tall hair tucked under a beanie, leaves the tag where it was.
    expect(tagHeight({ kind: "human", look: { ...look([]), hair: "short" } })).toBe(1.08);
    expect(tagHeight({ kind: "human", look: { ...look(["beanie"]), hair: "afro" } })).toBe(1.08);
  });
});

describe("hair on 3D figures", () => {
  const triangles = (g: BufferGeometry) =>
    (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
  /** The highest point of any piece, in the head's own y. */
  const topOf = (pieces: readonly { geo: BufferGeometry }[]) => {
    let top = Number.NEGATIVE_INFINITY;
    for (const { geo } of pieces) {
      const at = geo.getAttribute("position");
      for (let i = 0; i < (at?.count ?? 0); i++) top = Math.max(top, at?.getY(i) ?? top);
    }
    return top;
  };

  it("is one mesh per figure, in the hair's color, and none without a style", () => {
    const bare = { color: "sky" as const, shape: "round" as const };
    expect(hairMesh(bare)).toBeUndefined();
    expect(hairMesh({ ...bare, hairColor: "pink" })).toBeUndefined();
    expect(hairMesh({ ...bare, hair: "mullet" as never })).toBeUndefined();
    const pink = new Color(HAIR_COLOR_INFO.pink.hex);
    for (const hair of HAIR_STYLES) {
      const mesh = hairMesh({ ...bare, hair, hairColor: "pink" });
      const colors = mesh?.geometry.getAttribute("color");
      expect(colors, hair).toBeDefined();
      expect([colors?.getX(0), colors?.getY(0), colors?.getZ(0)], hair).toEqual(
        [pink.r, pink.g, pink.b].map((c) => expect.closeTo(c, 5)),
      );
      // One draw call each, inside decision 0060's frame budget with 24 figures in view.
      expect(triangles(mesh?.geometry as BufferGeometry), hair).toBeLessThan(1300);
    }
  });

  it("keeps every style under a hat's band, so nothing pokes through the hat", () => {
    for (const [hat, band] of Object.entries(HAT_BAND)) {
      for (const hair of HAIR_STYLES) {
        // Positions are 32-bit floats, so allow for their rounding.
        expect(topOf(hairPieces(hair, band)), `${hair} under ${hat}`).toBeLessThanOrEqual(
          (band ?? 0) + 1e-4,
        );
      }
    }
    // Without a hat, the bun and the spikes stand well above that.
    expect(topOf(hairPieces("bun"))).toBeGreaterThan(0.2);
    expect(topOf(hairPieces("spiky"))).toBeGreaterThan(0.25);
  });
});

describe("palette", () => {
  it("uses the same resident colors as the 2D map", () => {
    for (const c of RESIDENT_COLORS) expect(residentHex(c)).toBe(hex(RESIDENT_COLOR_HEX[c]));
  });

  it("gives every block a look, glass see-through and the rest solid", () => {
    for (const b of BLOCK_KINDS) {
      const look = blockLook(b);
      expect(look.height).toBeGreaterThan(0);
      expect(look.opacity > 0 && look.opacity <= 1).toBe(true);
    }
    expect(blockLook("glass").opacity).toBeLessThan(1);
    expect(blockLook("stone").color).toBe(hex(blockColor("stone")));
    expect(blockLook("leaf").form).toBe("clump");
  });

  it("matches the brand tokens in tokens.css", () => {
    const css = readFileSync(join(import.meta.dirname, "../../ui/src/tokens.css"), "utf8");
    const token = (name: string) => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
      if (!m?.[1]) throw new Error(`no --${name}`);
      return hex(m[1]);
    };
    for (const [name, value] of Object.entries(BRAND_HEX)) {
      const kebab = name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);
      expect(hex(value), name).toBe(token(kebab));
    }
    expect(BRAND.paper).toBe(token("paper"));
    expect(BRAND.ink).toBe(token("ink"));
  });

  it("mixes and shades colors channel by channel", () => {
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0x102030, 0x405060, 0)).toBe(0x102030);
    expect(mix(0x102030, 0x405060, 2)).toBe(0x405060);
    expect(shade(0x808080, 1)).toBe(0xffffff);
    expect(shade(0x808080, -1)).toBe(0x000000);
    expect(() => hex("red")).toThrow();
  });
});

describe("a resident's own home model", () => {
  it("reads homeModel and homeArt only when they are our media", () => {
    expect(mediaRef("m_0123456789abcdef")).toBe("/media/m_0123456789abcdef");
    expect(mediaRef("/media/m_0123456789abcdef")).toBe("/media/m_0123456789abcdef");
    expect(mediaRef("https://evil.example/m.glb")).toBeUndefined();
    expect(mediaRef("/media/m_0123456789abcdef?x=1")).toBeUndefined();
    expect(mediaRef(42)).toBeUndefined();
    expect(homeExtras({ homeModel: "m_0123456789abcdef", homeArt: "javascript:alert(1)" })).toEqual(
      { homeModel: "/media/m_0123456789abcdef" },
    );
    expect(homeExtras(null)).toEqual({});
    const raw = { residents: [{ id: "a", homeArt: "m_aaaaaaaaaaaaaaaa" }] };
    expect(homeExtras(rawResident(raw, "a"))).toEqual({ homeArt: "/media/m_aaaaaaaaaaaaaaaa" });
    expect(rawResident({ residents: "nope" }, "a")).toBeUndefined();
  });

  it("centers the footprint on the hearth and keeps it on the plot", () => {
    const layout = plotLayout(world(), "capri");
    if (!layout) throw new Error("no layout");
    const f = modelFootprint(layout);
    expect(f).toMatchObject({ x: 11, y: 11, width: 5, depth: 5, height: 4 });
    expect(underFootprint(f, 9, 9)).toBe(true);
    expect(underFootprint(f, 14, 11)).toBe(false);
    // A hearth in the corner pushes the footprint back onto the plot.
    const corner = { ...layout, hearth: { x: 8, y: 15 } };
    const g = modelFootprint(corner);
    expect(g.x - g.width / 2).toBe(7.5);
    expect(g.y + g.depth / 2).toBe(15.5);
  });

  it("fits a model by its tightest axis, grounded and centered", () => {
    // 10 wide, 2 tall, 4 deep, sitting below the origin and off to one side.
    const { scale, offset } = fitModel(
      { min: [10, -3, -2], max: [20, -1, 2] },
      { width: 5, height: 4, depth: 5 },
    );
    expect(scale).toBeCloseTo(0.5);
    // After scaling, the middle moves to x = 0, z = 0 and the base to y = 0.
    expect(offset[0]).toBeCloseTo(-7.5);
    expect(offset[1]).toBeCloseTo(1.5);
    expect(offset[2]).toBeCloseTo(0);
    // A tall thin model is limited by height instead.
    expect(
      fitModel({ min: [0, 0, 0], max: [1, 8, 1] }, { width: 5, height: 4, depth: 5 }).scale,
    ).toBe(0.5);
    // A flat picture plane doesn't limit the scale; a point keeps scale 1.
    expect(
      fitModel({ min: [0, 0, 0], max: [2, 1, 0] }, { width: 5, height: 4, depth: 5 }).scale,
    ).toBe(2.5);
    expect(
      fitModel({ min: [1, 1, 1], max: [1, 1, 1] }, { width: 5, height: 4, depth: 5 }).scale,
    ).toBe(1);
  });

  it("refuses models over the triangle or texture budget", () => {
    expect(
      overBudget({ triangles: 1000, texturePixels: 1024 * 1024, textures: 2 }),
    ).toBeUndefined();
    expect(overBudget({ triangles: 1_000_000, texturePixels: 0, textures: 0 })).toBe("triangles");
    expect(overBudget({ triangles: 10, texturePixels: 8192 * 8192, textures: 1 })).toBe("textures");
    expect(overBudget({ triangles: 10, texturePixels: 0, textures: 40 })).toBe("textures");
  });
});

describe("gallery requests", () => {
  it("accepts known items and our own media only", () => {
    expect(parseGallery("")).toEqual({});
    expect(parseGallery("?item=jam-apricot")).toEqual({ item: "jam-apricot" });
    expect(parseGallery("?item=bomb")).toEqual({});
    for (const decor of ["lantern", "frame", "fence", "bench"])
      expect(parseGallery(`?item=${decor}`)).toEqual({ item: decor });
    expect(parseGallery("?item=painting&media=m_0123456789abcdef")).toEqual({
      item: "painting",
      media: "/media/m_0123456789abcdef",
    });
    expect(parseGallery("?item=painting&media=https://evil.example/x.png")).toEqual({
      item: "painting",
    });
  });
});

describe("three.js stays out of the main bundle", () => {
  const src = import.meta.dirname;
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
          ? [join(dir, e.name)]
          : [],
    );
  const rel = (f: string) => f.slice(src.length + 1);
  const lazy = new Set([
    "model-viewer.ts",
    "scene3d/art.ts",
    "scene3d/items.ts",
    "scene3d/decor.ts",
    "scene3d/displays.ts",
    "scene3d/plot.ts",
    "scene3d/gallery.ts",
    "scene3d/page.ts",
    "scene3d/wear.ts",
    "scene3d/hair.ts",
    "scene3d/buildings.ts",
    "scene3d/world.ts",
  ]);

  it("imports three only from the lazy 3D files", () => {
    for (const f of files(src)) {
      const text = readFileSync(f, "utf8");
      if (/from "three(\/|")/.test(text)) expect(lazy.has(rel(f)), rel(f)).toBe(true);
    }
  });

  it("reaches the lazy 3D files only through import() or type imports from outside them", () => {
    for (const f of files(src)) {
      if (lazy.has(rel(f))) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/^import (type )?[^;]*?from "(\.[^"]+)";/gms)) {
        const target = (m[2] ?? "").replace(/^\.\//, "").replace(/^\.\.\//, "");
        const hit = [...lazy].some((l) => `${target}.ts`.endsWith(l));
        if (hit) expect(m[1], `${rel(f)} imports ${m[2]}`).toBe("type ");
      }
    }
  });
});
