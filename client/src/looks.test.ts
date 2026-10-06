import type { LookView } from "@terrakin/protocol";
import {
  PATTERNS,
  RESIDENT_COLORS,
  THEME_INFO,
  THEMES,
  type ThemePalette,
  type WearItem,
  type WearStyles,
} from "@terrakin/sim";
import {
  COLOR_WORDS,
  garmentName,
  hairName,
  lookPalette,
  luminance,
  type MakeCanvas,
  mediaUrlOf,
  mix,
  motifBounds,
  PatternCache,
  paintMotif,
  patternMotifs,
  RESIDENT_COLOR_HEX,
  swatchBacking,
  waveY,
} from "@terrakin/ui/looks";
import { describe, expect, it } from "vitest";
import { lookChanges, mediaProblem, wearChoices, wearWith, withoutOwnPattern } from "./look-editor";
import { Mirror } from "./mirror";

describe("mirror looks", () => {
  it("sets a look from profile_changed and clears what the event leaves out", () => {
    const mirror = new Mirror({
      v: 1,
      seq: 1,
      hash: "x",
      config: { width: 8, height: 8, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
      commons: { px: 1, py: 1 },
      residents: [
        {
          id: "a",
          name: "Capri",
          kind: "human",
          color: "sun",
          shape: "round",
          note: "",
          x: 1,
          y: 1,
          online: true,
          hearth: null,
          theme: "lemon",
          wear: ["straw_hat"],
          hair: "bob",
          hairColor: "auburn",
        },
      ],
      plots: [],
      blocks: [],
    });
    expect(mirror.residents.get("a")).toMatchObject({
      theme: "lemon",
      wear: ["straw_hat"],
      hair: "bob",
      hairColor: "auburn",
    });
    mirror.apply({
      seq: 2,
      event: {
        type: "profile_changed",
        residentId: "a",
        color: "sun",
        shape: "round",
        note: "",
        pattern: "citrus",
      },
    });
    const after = mirror.residents.get("a");
    expect(after?.pattern).toBe("citrus");
    expect(after && "theme" in after).toBe(false);
    expect(after && "wear" in after).toBe(false);
    expect(after && "hair" in after).toBe(false);
  });

  it("keeps garment styles from the snapshot and from profile_changed", () => {
    const mirror = new Mirror({
      v: 1,
      seq: 1,
      hash: "x",
      config: { width: 8, height: 8, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
      commons: { px: 1, py: 1 },
      residents: [
        {
          id: "a",
          name: "Capri",
          kind: "human",
          color: "sun",
          shape: "round",
          note: "",
          x: 1,
          y: 1,
          online: true,
          hearth: null,
          wear: ["dress"],
          wearStyle: { dress: { pattern: "citrus", color: "sun" } },
        },
      ],
      plots: [],
      blocks: [],
    });
    expect(mirror.residents.get("a")?.wearStyle).toEqual({
      dress: { pattern: "citrus", color: "sun" },
    });
    mirror.apply({
      seq: 2,
      event: {
        type: "profile_changed",
        residentId: "a",
        color: "sun",
        shape: "round",
        note: "",
        wear: ["dress", "socks"],
        wearStyle: { dress: { pattern: "citrus", color: "sun" }, socks: { pattern: "stripes" } },
      },
    });
    expect(mirror.residents.get("a")?.wearStyle).toEqual({
      dress: { pattern: "citrus", color: "sun" },
      socks: { pattern: "stripes" },
    });
  });
});

/** A 2D context that records what was drawn, so tiles can be checked without a browser. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    { fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", globalAlpha: 1 },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        return (...args: unknown[]) => calls.push(`${String(key)}(${args.length})`);
      },
      set(target, key, value) {
        (target as Record<string, unknown>)[key as string] = value;
        if (key === "fillStyle" || key === "strokeStyle") calls.push(`${String(key)}=${value}`);
        return true;
      },
    },
  );
  return { ctx, calls };
}

describe("pattern swatches", () => {
  it("sit on a darker backing when the outfit is pale, so a pale motif shows", () => {
    const snow = lookPalette(undefined, "snow");
    const backing = swatchBacking(snow.main);
    expect(backing).not.toBe(snow.main);
    const gap = (a: string, b: string) => Math.abs(luminance(a) - luminance(b));
    expect(gap(backing, snow.light)).toBeGreaterThan(3 * gap(snow.main, snow.light));
    // A mid-tone outfit keeps its own color.
    const sky = lookPalette(undefined, "sky");
    expect(swatchBacking(sky.main)).toBe(sky.main);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
  });
});

describe("theme palettes", () => {
  it("looks up a theme's palette, and makes one from the resident color without a theme", () => {
    expect(lookPalette("lemon", "plum")).toBe(THEME_INFO.lemon.palette);
    const own = lookPalette(undefined, "sky");
    expect(own.ground).toBe(RESIDENT_COLOR_HEX.sky);
    for (const color of Object.values(own)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    // A theme the client doesn't know yet (a newer server) falls back instead of breaking.
    expect(lookPalette("disco" as never, "sun").ground).toBe(RESIDENT_COLOR_HEX.sun);
  });

  it("mixes colors", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("gives every theme readable contrast between clothes and motif", () => {
    const lum = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    for (const theme of THEMES) {
      const p = THEME_INFO[theme].palette;
      const gap = Math.max(
        Math.abs(lum(p.main) - lum(p.accent)),
        Math.abs(lum(p.main) - lum(p.deep)),
      );
      expect(gap, theme).toBeGreaterThan(40);
    }
  });
});

describe("pattern tiles", () => {
  it("keeps every motif inside its tile so tiles repeat without seams", () => {
    for (const pattern of PATTERNS) {
      for (const m of patternMotifs(pattern)) {
        const b = motifBounds(m);
        expect(b.x0, pattern).toBeGreaterThanOrEqual(0);
        expect(b.y0, pattern).toBeGreaterThanOrEqual(0);
        expect(b.x1, pattern).toBeLessThanOrEqual(1);
        expect(b.y1, pattern).toBeLessThanOrEqual(1);
        if (m.kind === "wave") expect(waveY(m, 0)).toBeCloseTo(waveY(m, 1));
      }
    }
    expect(patternMotifs("plain")).toEqual([]);
    expect(patternMotifs("plaid" as never)).toEqual([]);
  });

  it("draws each motif with the palette's colors", () => {
    const palette: ThemePalette = THEME_INFO.lemon.palette;
    for (const pattern of PATTERNS) {
      for (const m of patternMotifs(pattern)) {
        const { ctx, calls } = recorder();
        paintMotif(ctx as never, m, palette, 0, 0, 32);
        const colors = calls.filter((c) => c.includes("Style=")).map((c) => c.split("=")[1]);
        expect(colors.length, `${pattern} ${m.kind}`).toBeGreaterThan(0);
        expect(calls.some((c) => /^(fill|stroke|fillRect)\(/.test(c))).toBe(true);
      }
    }
  });

  it("makes each tile once and reuses it", () => {
    let made = 0;
    const make: MakeCanvas = () => {
      made++;
      return { canvas: {} as CanvasImageSource, ctx: recorder().ctx as never };
    };
    const patterns = new PatternCache(make, 50);
    let created = 0;
    const target = {
      createPattern: () => {
        created++;
        return {} as CanvasPattern;
      },
    };
    const lemon = THEME_INFO.lemon.palette;
    const first = patterns.named(target, "citrus", lemon, 12);
    expect(first).not.toBeNull();
    expect(patterns.named(target, "citrus", lemon, 12)).toBe(first);
    expect([made, created]).toEqual([1, 1]);
    patterns.named(target, "citrus", THEME_INFO.ocean.palette, 12);
    patterns.named(target, "citrus", lemon, 24);
    expect(made).toBe(3);
    expect(patterns.named(target, "plain", lemon, 12)).toBeNull();
    expect(made).toBe(3);
  });

  it("stays bounded", () => {
    const make: MakeCanvas = () => ({
      canvas: {} as CanvasImageSource,
      ctx: recorder().ctx as never,
    });
    const patterns = new PatternCache(make, 10);
    const target = { createPattern: () => ({}) as CanvasPattern };
    for (let px = 4; px < 40; px++) patterns.named(target, "dots", THEME_INFO.berry.palette, px);
    expect(patterns.size).toBeLessThanOrEqual(10);
  });
});

describe("look media", () => {
  it("only ever makes our own media URLs", () => {
    expect(mediaUrlOf("m_0123456789abcdef")).toBe("/media/m_0123456789abcdef");
    expect(mediaUrlOf("m_../../secret")).toBeUndefined();
    expect(mediaUrlOf("https://example.com/x.png")).toBeUndefined();
    expect(mediaUrlOf(undefined)).toBeUndefined();
  });

  it("checks an upload fits its slot before saving", () => {
    expect(mediaProblem("patternMedia", { kind: "image", type: "image/png" })).toBeNull();
    expect(mediaProblem("homeArt", { kind: "image", type: "image/gif" })).toMatch(/PNG/);
    expect(mediaProblem("homeArt", { kind: "video", type: "video/mp4" })).toMatch(/PNG/);
    expect(mediaProblem("homeModel", { kind: "model", type: "model/gltf-binary" })).toBeNull();
    expect(mediaProblem("homeModel", { kind: "image", type: "image/png" })).toMatch(/glb/);
  });

  it("sends only what changed, with null to clear", () => {
    const before = {
      theme: "lemon",
      wear: ["straw_hat", "basket"],
      hair: "bob",
      hairColor: "auburn",
    } as const;
    const same = {
      theme: "lemon",
      pattern: null,
      wear: ["basket", "straw_hat"],
      patternMedia: null,
      homeArt: null,
      homeModel: null,
      wearStyle: {},
      hair: "bob",
      hairColor: "auburn",
    } as const;
    expect(
      lookChanges({ ...before, wear: [...before.wear] }, { ...same, wear: [...same.wear] }),
    ).toEqual({});
    expect(
      lookChanges(
        { ...before, wear: [...before.wear] },
        { ...same, theme: null, wear: [], pattern: "citrus", hair: null, hairColor: "pink" },
      ),
    ).toEqual({ theme: null, wear: [], pattern: "citrus", hair: null, hairColor: "pink" });
  });

  it("sends garment styles item by item: the new style for a change, null for a cleared one", () => {
    const before: LookView = {
      wear: ["dress"],
      wearStyle: { dress: { pattern: "citrus", color: "sun" }, socks: { pattern: "stripes" } },
    };
    const draft = (wear: WearItem[], wearStyle: WearStyles) => ({
      theme: null,
      pattern: null,
      wear,
      patternMedia: null,
      homeArt: null,
      homeModel: null,
      wearStyle,
      hair: null,
      hairColor: null,
    });
    const kept: WearStyles = {
      dress: { pattern: "citrus", color: "sun" },
      socks: { pattern: "stripes" },
    };
    expect(lookChanges(before, draft(["dress"], kept))).toEqual({});
    expect(
      lookChanges(
        before,
        draft(["dress", "socks"], { dress: { pattern: "citrus", color: "sky" } }),
      ),
    ).toEqual({
      wear: ["dress", "socks"],
      wearStyle: { dress: { pattern: "citrus", color: "sky" }, socks: null },
    });
    // A style with nothing left in it clears the garment's style.
    expect(lookChanges(before, draft(["dress"], { socks: {} }))).toEqual({
      wearStyle: { dress: null, socks: null },
    });
  });

  it("takes the bottom off for a dress, and the dress off for a bottom", () => {
    expect(wearWith(["straw_hat", "skirt"], "top", "dress")).toEqual(["straw_hat", "dress"]);
    expect(wearWith(["dress", "socks"], "bottom", "trousers")).toEqual(["socks", "trousers"]);
    expect(wearWith(["apron", "skirt"], "top", "cardigan")).toEqual(["skirt", "cardigan"]);
    expect(wearWith(["dress", "boots"], "feet", null)).toEqual(["dress"]);
  });

  it("names a styled garment in plain words from the catalogs", () => {
    expect(garmentName("dress", { pattern: "citrus", color: "sun" })).toBe(
      "Citrus dress in sun yellow",
    );
    expect(garmentName("socks", { pattern: "stripes" })).toBe("Striped socks");
    expect(garmentName("straw_hat", { color: "plum" })).toBe("Straw hat in plum purple");
    expect(garmentName("beret", { pattern: "plain", color: "coal" })).toBe("Beret in coal black");
    expect(garmentName("skirt", { pattern: "own" })).toBe("Own pattern skirt");
    expect(garmentName("boots")).toBe("Boots");
    for (const color of RESIDENT_COLORS) expect(COLOR_WORDS[color]).toMatch(/^[a-z ]+$/);
  });

  it("names hair in plain words, brown until a color is picked", () => {
    expect(hairName("bob", "auburn")).toBe("Auburn bob");
    expect(hairName("curly", "black")).toBe("Black curly hair");
    expect(hairName("pigtails")).toBe("Brown pigtails");
    expect(hairName("mullet" as never, "pink")).toBeUndefined();
  });
});

describe("removing your own pattern", () => {
  it("takes it off every garment, keeping colors and other patterns", () => {
    expect(
      withoutOwnPattern({
        skirt: { pattern: "own", color: "plum" },
        socks: { pattern: "own" },
        dress: { pattern: "citrus" },
      }),
    ).toEqual({ skirt: { color: "plum" }, dress: { pattern: "citrus" } });
  });
});

describe("partner wear in the look editor (RFC 0007)", () => {
  it("offers partner wear only to residents who may wear it, or already have it on", () => {
    expect(wearChoices("hat", [], [])).not.toContain("muse_halo");
    expect(wearChoices("hat", ["muse_halo"], [])).toContain("muse_halo");
    expect(wearChoices("hat", [], ["muse_halo"])).toContain("muse_halo");
    expect(wearChoices("accessory", ["muse_halo"], [])).not.toContain("muse_lantern");
    expect(wearChoices("hat", [], [])).toContain("straw_hat");
    expect(wearChoices("hat", [], [])).toContain("top_hat");
  });
});
