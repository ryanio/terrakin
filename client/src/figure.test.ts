import { RESIDENT_COLORS, THEME_INFO, WEAR_INFO, WEAR_ITEMS, type WearItem } from "@terrakin/sim";
import { drawFigure, type FigureLook, garmentLook } from "@terrakin/ui/figure";
import { lookPalette, type MakeCanvas, PatternCache, RESIDENT_COLOR_HEX } from "@terrakin/ui/looks";
import { describe, expect, it } from "vitest";

/** A 2D context that records every call and color, so a drawing can be compared without a browser. */
function recorder() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
  };
  let patterns = 0;
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "createPattern") return () => ({ id: `pattern${++patterns}` });
      if (key in target) return target[key as string];
      return (...args: unknown[]) => {
        const nums = args.map((a) => (typeof a === "number" ? a.toFixed(2) : String(a)));
        calls.push(`${String(key)}(${nums.join(",")})`);
      };
    },
    set(target, key, value) {
      target[key as string] = value;
      const shown = typeof value === "object" ? JSON.stringify(value) : String(value);
      calls.push(`${String(key)}=${shown}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const fakeTiles: MakeCanvas = () => ({
  canvas: {} as CanvasImageSource,
  ctx: recorder().ctx as never,
});

/** Everything drawing one figure does, in order. */
function draw(look: FigureLook, facing: "s" | "n" | "e" = "s"): string[] {
  const { ctx, calls } = recorder();
  drawFigure(ctx, 40, look, null, facing, new PatternCache(fakeTiles));
  return calls;
}

const base: FigureLook = { color: "rose", shape: "round", theme: "lemon" };

describe("garment looks", () => {
  it("leaves an unstyled garment as it is, in the outfit's palette", () => {
    expect(garmentLook(base, "dress")).toEqual({
      color: undefined,
      pattern: undefined,
      own: false,
      palette: THEME_INFO.lemon.palette,
    });
    // A style kept for another garment changes nothing here.
    expect(garmentLook({ ...base, wearStyle: { socks: { color: "sky" } } }, "dress").color).toBe(
      undefined,
    );
  });

  it("takes the garment's own color and pattern, with its motif in that color's palette", () => {
    const look = { ...base, wearStyle: { dress: { pattern: "citrus", color: "sun" } } } as const;
    expect(garmentLook(look, "dress")).toEqual({
      color: RESIDENT_COLOR_HEX.sun,
      pattern: "citrus",
      own: false,
      palette: lookPalette(undefined, "sun"),
    });
    for (const color of RESIDENT_COLORS) {
      expect(garmentLook({ ...base, wearStyle: { beret: { color } } }, "beret").color).toBe(
        RESIDENT_COLOR_HEX[color],
      );
    }
    // Plain is a choice: no motif, even on a dress that would otherwise wear the outfit's.
    expect(
      garmentLook({ ...base, wearStyle: { dress: { pattern: "plain" } } }, "dress"),
    ).toMatchObject({ pattern: "plain", color: undefined });
  });

  it("uses your own tile for `own`, and falls back to the outfit's pattern, then the theme's", () => {
    const own = { wearStyle: { skirt: { pattern: "own" } } } as const;
    expect(
      garmentLook(
        { ...base, ...own, patternMedia: "m_0123456789abcdef", pattern: "dots" },
        "skirt",
      ),
    ).toMatchObject({ own: true, pattern: "dots" });
    expect(garmentLook({ ...base, ...own, pattern: "stars" }, "skirt")).toMatchObject({
      own: false,
      pattern: "stars",
    });
    expect(garmentLook({ ...base, ...own }, "skirt").pattern).toBe(THEME_INFO.lemon.motif);
    expect(garmentLook({ color: "sky", ...own }, "skirt").pattern).toBe("plain");
  });

  it("ignores a color or pattern this client doesn't know", () => {
    const look = { ...base, wearStyle: { dress: { color: "teal", pattern: "plaid" } } } as never;
    expect(garmentLook(look, "dress")).toMatchObject({ color: undefined, pattern: undefined });
  });
});

describe("drawn garments", () => {
  const bare = draw(base);

  it("draws every piece of wear, from every side it shows on", () => {
    // From behind, an apron and glasses are hidden by the figure itself.
    const front: readonly WearItem[] = ["apron", "glasses"];
    for (const item of WEAR_ITEMS) {
      for (const facing of ["s", "n", "e"] as const) {
        if (facing === "n" && front.includes(item)) continue;
        const calls = draw({ ...base, wear: [item] }, facing);
        expect(calls.join("\n"), `${item} ${facing}`).not.toBe(draw(base, facing).join("\n"));
        expect(calls.join("\n"), item).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it("draws a styled garment differently from an unstyled one", () => {
    for (const item of WEAR_ITEMS) {
      const plain = draw({ ...base, wear: [item] });
      const colored = draw({ ...base, wear: [item], wearStyle: { [item]: { color: "plum" } } });
      const patterned = draw({ ...base, wear: [item], wearStyle: { [item]: { pattern: "dots" } } });
      expect(colored.join("\n"), `${item} in plum`).not.toBe(plain.join("\n"));
      expect(patterned.join("\n"), `${item} in dots`).not.toBe(plain.join("\n"));
      expect(colored.join("\n"), `${item} uses plum`).toContain(`Style=${RESIDENT_COLOR_HEX.plum}`);
    }
  });

  it("draws an unstyled garment exactly as before, whatever styles are kept for others", () => {
    for (const item of WEAR_ITEMS) {
      const other: WearItem = item === "socks" ? "boots" : "socks";
      const kept = { [other]: { pattern: "hearts", color: "coal" } } as const;
      expect(draw({ ...base, wear: [item], wearStyle: kept })).toEqual(
        draw({ ...base, wear: [item] }),
      );
    }
    expect(bare.length).toBeGreaterThan(10);
  });

  it("dresses a whole outfit at once, a dress with socks and boots in their own patterns", () => {
    const outfit: FigureLook = {
      ...base,
      wear: ["straw_hat", "dress", "basket", "socks"],
      wearStyle: {
        dress: { pattern: "citrus", color: "sun" },
        socks: { pattern: "stripes" },
        straw_hat: { color: "snow" },
      },
    };
    const calls = draw(outfit);
    expect(calls.filter((c) => c.startsWith("clip(")).length).toBeGreaterThan(2);
    expect(calls).toContain(`fillStyle=${RESIDENT_COLOR_HEX.sun}`);
    expect(new Set(WEAR_ITEMS.map((w) => WEAR_INFO[w].slot)).size).toBe(5);
  });
});
