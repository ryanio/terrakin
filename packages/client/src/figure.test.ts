import {
  COSTUMES,
  type Direction,
  HAIR_COLOR_INFO,
  HAIR_STYLES,
  RESIDENT_COLORS,
  THEME_INFO,
  WEAR_INFO,
  WEAR_ITEMS,
  type WearItem,
} from "@terrakin/sim";
import { FEELINGS, isFeeling } from "@terrakin/ui/feelings";
import {
  drawFeelingIcon,
  drawFigure,
  FEELING_ICON,
  type FigureFace,
  type FigureLook,
  garmentLook,
} from "@terrakin/ui/figure";
import {
  HIDES_HAIR,
  hairOf,
  lookPalette,
  type MakeCanvas,
  PatternCache,
  RESIDENT_COLOR_HEX,
} from "@terrakin/ui/looks";
import { describe, expect, it } from "vitest";
import {
  Feelings,
  gestureReaction,
  HOLD_MS,
  idPhase,
  LISTEN_MS,
  pose,
  restingPose,
} from "./feelings";
import { faceKey } from "./render";

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
function draw(look: FigureLook, facing: Direction = "s", face: FigureFace = {}): string[] {
  const { ctx, calls } = recorder();
  drawFigure(ctx, 40, look, null, facing, new PatternCache(fakeTiles), face);
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

  it("rolls the umbrella up and carries it when it isn't raining, from every side", () => {
    const brolly = { ...base, wear: ["umbrella"] } as const;
    for (const facing of ["s", "n", "e"] as const) {
      const up = draw(brolly, facing).join("\n");
      const rolled = draw(brolly, facing, { furled: true }).join("\n");
      expect(rolled, facing).not.toBe(up);
      expect(rolled, facing).not.toBe(draw(base, facing).join("\n"));
      expect(rolled, facing).not.toMatch(/NaN|undefined/);
    }
    // In its own color, rolled up too.
    const plum = { ...brolly, wearStyle: { umbrella: { color: "plum" } } } as const;
    expect(draw(plum, "s", { furled: true })).toContain(`fillStyle=${RESIDENT_COLOR_HEX.plum}`);
    // Nothing else changes with the weather.
    const dress = { ...base, wear: ["dress"] } as const;
    expect(draw(dress, "s", { furled: true })).toEqual(draw(dress));
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

describe("hair", () => {
  const pink = `fillStyle=${HAIR_COLOR_INFO.pink.hex}`;

  it("draws every style from every side in its color, and nothing for a color alone", () => {
    for (const facing of ["s", "n", "e", "w"] as const) {
      const bald = draw(base, facing).join("\n");
      expect(draw({ ...base, hairColor: "pink" }, facing).join("\n"), facing).toBe(bald);
      const drawn = HAIR_STYLES.map((hair) =>
        draw({ ...base, hair, hairColor: "pink" }, facing).join("\n"),
      );
      for (const [i, calls] of drawn.entries()) {
        expect(calls, `${HAIR_STYLES[i]} ${facing}`).toContain(pink);
        expect(calls, `${HAIR_STYLES[i]} ${facing}`).not.toMatch(/NaN|undefined/);
      }
      // Each style is its own drawing, from every side.
      expect(new Set(drawn).size, facing).toBe(HAIR_STYLES.length);
    }
  });

  it("is brown until a color is picked, and none for a style or color this client doesn't know", () => {
    expect(hairOf({ hair: "bob" })).toEqual({ style: "bob", hex: HAIR_COLOR_INFO.brown.hex });
    expect(hairOf({ hair: "bob", hairColor: "teal" as never })?.hex).toBe(
      HAIR_COLOR_INFO.brown.hex,
    );
    expect(hairOf({ hair: "mullet" as never, hairColor: "pink" })).toBeUndefined();
    expect(draw({ ...base, hair: "mullet" as never })).toEqual(draw(base));
  });

  it("paints every hat over the hair, from every side, and a pumpkin head hides it", () => {
    for (const hat of WEAR_ITEMS.filter((w) => WEAR_INFO[w].slot === "hat")) {
      for (const facing of ["s", "n", "e"] as const) {
        const calls = draw({ ...base, wear: [hat], hair: "long", hairColor: "pink" }, facing);
        const lastHair = calls.lastIndexOf(pink);
        if (HIDES_HAIR.includes(hat)) {
          expect(lastHair, `${hat} ${facing}`).toBe(-1);
          continue;
        }
        expect(lastHair, `${hat} ${facing}`).toBeGreaterThan(-1);
        // The hat is painted after the hair, so it sits on top.
        const hatOnly = draw({ ...base, wear: [hat] }, facing);
        const hatStart = calls.length - (hatOnly.length - draw(base, facing).length);
        expect(lastHair, `${hat} ${facing}`).toBeLessThan(hatStart);
      }
    }
  });
});

describe("Halloween's costumes (RFC 0022)", () => {
  const pink = `fillStyle=${HAIR_COLOR_INFO.pink.hex}`;

  it("hide the hair under a pumpkin head or a ghost sheet, and nowhere else, from every side", () => {
    for (const item of COSTUMES) {
      for (const facing of ["s", "n", "e", "w"] as const) {
        const calls = draw({ ...base, wear: [item], hair: "long", hairColor: "pink" }, facing);
        expect(calls.includes(pink), `${item} ${facing}`).toBe(!HIDES_HAIR.includes(item));
      }
    }
  });

  it("show the face through a ghost sheet, and carve one into a pumpkin head", () => {
    const ghost: FigureLook = { ...base, wear: ["ghost_sheet"] };
    expect(draw(ghost, "s", { feeling: "happy" })).not.toEqual(draw(ghost));
    const pumpkin: FigureLook = { ...base, wear: ["pumpkin_head"] };
    expect(draw(pumpkin, "s", { feeling: "happy" })).toEqual(draw(pumpkin));
    // From the back there's no face to carve, and the pumpkin still turns with them.
    expect(draw(pumpkin, "n")).not.toEqual(draw(pumpkin, "s"));
  });
});

describe("faces", () => {
  const drawn = (face: FigureFace, facing: "s" | "e" = "s") => draw(base, facing, face).join("\n");

  it("draws every feeling its own way, from the front and in profile", () => {
    for (const facing of ["s", "e"] as const) {
      const seen = new Set(FEELINGS.map((feeling) => drawn({ feeling }, facing)));
      expect(seen.size, facing).toBe(FEELINGS.length);
      for (const feeling of FEELINGS)
        expect(drawn({ feeling }, facing)).not.toMatch(/NaN|undefined/);
    }
    // No feeling is the neutral face, drawn as it always was.
    expect(drawn({ feeling: "neutral" })).toBe(drawn({}));
  });

  it("closes open eyes for a blink, and leaves shut or curved eyes alone", () => {
    expect(drawn({ blink: true })).not.toBe(drawn({}));
    expect(drawn({ feeling: "surprised", blink: true })).not.toBe(drawn({ feeling: "surprised" }));
    for (const feeling of ["happy", "laugh", "love", "sleepy"] as const)
      expect(drawn({ feeling, blink: true }), feeling).toBe(drawn({ feeling }));
  });

  it("raises a hand to wave, at either end of the wave, from every side", () => {
    for (const facing of ["s", "n", "e"] as const) {
      const still = draw(base, facing).join("\n");
      const up = draw(base, facing, { wave: 1 }).join("\n");
      const over = draw(base, facing, { wave: 2 }).join("\n");
      expect(new Set([still, up, over]).size, facing).toBe(3);
    }
  });

  it("gives some feelings a floating sign, and draws each sign", () => {
    expect(Object.keys(FEELING_ICON).every(isFeeling)).toBe(true);
    for (const icon of new Set(Object.values(FEELING_ICON))) {
      const { ctx, calls } = recorder();
      drawFeelingIcon(ctx, icon, 40);
      expect(
        calls.some((c) => c.startsWith("fill(") || c.startsWith("stroke(")),
        icon,
      ).toBe(true);
    }
    expect(isFeeling("angry")).toBe(false);
  });

  it("keys sprites by feeling, blink, wave, and umbrella, and reuses one for a blink on shut eyes", () => {
    const keys = new Set(FEELINGS.map((feeling) => faceKey({ feeling })));
    expect(keys.size).toBe(FEELINGS.length);
    expect(faceKey({})).toBe(faceKey({ feeling: "neutral", blink: false, wave: 0, furled: false }));
    expect(faceKey({ blink: true })).not.toBe(faceKey({}));
    expect(faceKey({ feeling: "sleepy", blink: true })).toBe(faceKey({ feeling: "sleepy" }));
    expect(faceKey({ feeling: "happy", wave: 1 })).not.toBe(faceKey({ feeling: "happy", wave: 2 }));
    expect(faceKey({ furled: true })).not.toBe(faceKey({}));
  });
});

describe("feelings", () => {
  it("answers each gesture: love for a hug or kiss, a wave back, a hop for a high five", () => {
    expect(gestureReaction("hug")).toEqual({ feeling: "love" });
    expect(gestureReaction("kiss")).toEqual({ feeling: "love" });
    expect(gestureReaction("comfort")).toEqual({ feeling: "love" });
    expect(gestureReaction("wave")).toEqual({ feeling: "happy", cue: "wave" });
    expect(gestureReaction("high_five")).toEqual({ feeling: "laugh", cue: "hop" });
    expect(gestureReaction("gift").feeling).toBe("happy");
  });

  it("shows one feeling at a time, the newest, held a few seconds, then neutral again", () => {
    const f = new Feelings();
    expect(f.feeling("lina", 0)).toBe("neutral");
    f.show("lina", { feeling: "love" }, 1000);
    expect(f.feeling("lina", 1000)).toBe("love");
    // The same object while it lasts, so a 3D figure only changes its face when this does.
    expect(f.get("lina", 2000)).toBe(f.get("lina", 3000));
    f.show("lina", { feeling: "laugh", cue: "hop" }, 2000);
    expect(f.get("lina", 2000)).toMatchObject({ feeling: "laugh", cue: "hop", at: 2000 });
    expect(f.feeling("lina", 2000 + HOLD_MS - 1)).toBe("laugh");
    expect(f.feeling("lina", 2000 + HOLD_MS)).toBe("neutral");
    expect(f.get("lina", 2000)).toBeUndefined();
    // Only the figure it happened to.
    f.show("lina", { feeling: "love" }, 9000);
    expect(f.feeling("felipe", 9000)).toBe("neutral");
  });

  it("remembers who spoke for a moment", () => {
    const f = new Feelings();
    expect(f.speaker(0)).toBeUndefined();
    f.heard("wren", 100);
    expect(f.speaker(100 + LISTEN_MS - 1)).toBe("wren");
    expect(f.speaker(100 + LISTEN_MS)).toBeUndefined();
  });

  it("blinks every few seconds, each figure at its own time", () => {
    const out = restingPose();
    const blinkTimes = (phase: number) => {
      const times: number[] = [];
      for (let t = 0; t < 12_000; t += 10)
        if (pose(undefined, t, phase, false, out).blink) times.push(t);
      return times;
    };
    const a = blinkTimes(idPhase("lina"));
    const b = blinkTimes(idPhase("felipe"));
    expect(a.length).toBeGreaterThan(20);
    expect(a.length).toBeLessThan(80);
    expect(a).not.toEqual(b);
    expect(idPhase("lina")).toBe(idPhase("lina"));
  });

  it("bounces, hops, waves and floats a sign, and with reduced motion keeps only the face", () => {
    const f = new Feelings();
    const hop = f.show("a", gestureReaction("high_five"), 0);
    const wave = f.show("b", gestureReaction("wave"), 0);
    const love = f.show("c", gestureReaction("hug"), 0);
    const moving = (shown: typeof hop, t: number) => ({
      ...pose(shown, t, 0.3, false, restingPose()),
    });
    const still = (shown: typeof hop, t: number) => ({
      ...pose(shown, t, 0.3, true, restingPose()),
    });

    expect(moving(hop, 240).lift).toBeGreaterThan(0.2);
    expect(moving(hop, 240).feeling).toBe("laugh");
    expect(moving(wave, 100).wave).toBeGreaterThan(0);
    expect(new Set([0, 250, 500].map((t) => moving(wave, t).wave)).size).toBe(2);
    expect(moving(wave, 5000).wave).toBe(0);
    expect(moving(love, 400).tilt).not.toBe(0);
    expect(moving(love, 850).rise).toBeGreaterThan(0);

    for (const shown of [hop, wave, love]) {
      for (let t = 0; t < HOLD_MS; t += 37) {
        const p = still(shown, t);
        expect(p.feeling).toBe(shown.feeling);
        expect(p).toMatchObject({ lift: 0, blink: false, rise: 0, fade: 1 });
        if (shown.feeling === "love") expect(p.tilt).toBe(0);
      }
    }
    // A wave still shows the hand, without the swing.
    expect(new Set([0, 250, 500].map((t) => still(wave, t).wave))).toEqual(new Set([1]));
  });
});
