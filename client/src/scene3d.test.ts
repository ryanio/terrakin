import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldSnapshot } from "@terrakin/protocol";
import { BLOCK_KINDS, RESIDENT_COLORS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { blockColor, RESIDENT_COLOR_HEX } from "./render";
import { parseGallery } from "./scene3d/catalog";
import {
  cornerLight,
  distanceOutside,
  fitModel,
  groundDecor,
  homeExtras,
  homePlot,
  mediaRef,
  modelFootprint,
  overBudget,
  plotBounds,
  plotLayout,
  rawResident,
  underFootprint,
} from "./scene3d/layout";
import { BRAND, blockLook, hex, mix, residentHex, shade } from "./scene3d/palette";

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
    const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
    const token = (name: string) => {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
      if (!m?.[1]) throw new Error(`no --${name}`);
      return hex(m[1]);
    };
    expect(BRAND.paper).toBe(token("paper"));
    expect(BRAND.ink).toBe(token("ink"));
    expect(BRAND.clay).toBe(token("clay"));
    expect(BRAND.moss).toBe(token("moss"));
    expect(BRAND.sun).toBe(token("sun"));
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
    "scene3d/plot.ts",
    "scene3d/gallery.ts",
    "scene3d/page.ts",
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
