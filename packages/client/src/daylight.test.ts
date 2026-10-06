import { describe, expect, it } from "vitest";
import { flicker, glowsAfterDark, lampLevel, lightAt } from "./scene3d/daylight";
import { litHomes } from "./scene3d/layout";
import { OVERCAST, SKY } from "./scene3d/palette";
import { dayPhase, nightAmount } from "./time";
import { WEATHER_LOOK } from "./weather";

const CLEAR = WEATHER_LOOK.clear;
const NOON = 0.25;
const DUSK = 0.5;
const MIDNIGHT = 0.75;
const DAWN = 0;

const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
/** Roughly how much light falls on the ground: each light's brightness times its color's. */
function brightness(phase: number | undefined, sky = CLEAR): number {
  const l = lightAt(phase, sky);
  const tone = (c: number) => channels(c).reduce((a, b) => a + b, 0) / (3 * 255);
  return (
    l.sun.intensity * tone(l.sun.color) +
    l.hemi.intensity * tone(l.hemi.sky) +
    l.fill.intensity * tone(l.fill.color)
  );
}

describe("the light in 3D through the day", () => {
  it("is the storybook day at noon, and with no clock at all", () => {
    const noon = lightAt(NOON, CLEAR);
    expect(lightAt(undefined, CLEAR)).toEqual(noon);
    expect(noon).toMatchObject({
      sun: { color: 0xffe8c8, intensity: 2.5 },
      hemi: { sky: 0xfff6e8, ground: 0x8f8a64, intensity: 1.3 },
      fill: { color: 0xd9c8f4, intensity: 0.55 },
      top: SKY.topHex,
      horizon: SKY.fog,
      reach: 1,
      glow: 0,
      stars: 0,
    });
  });

  it("gets dark as the map does, darkest at midnight, and light again by morning", () => {
    // Every step of the map's night amount darkens it, from noon through dusk to midnight, and
    // every step back lightens it, through dawn to noon. Colors are whole numbers, so a step may
    // round a hair the other way.
    const hair = 0.005;
    for (let i = 1; i <= 100; i++) {
      const a = NOON + ((i - 1) / 100) * 0.5;
      const b = NOON + (i / 100) * 0.5;
      expect(brightness(b), `${b}`).toBeLessThanOrEqual(brightness(a) + hair);
      expect(brightness(b + 0.5), `${b + 0.5}`).toBeGreaterThanOrEqual(brightness(a + 0.5) - hair);
    }
    expect(brightness(MIDNIGHT)).toBeLessThan(brightness(DUSK));
    expect(brightness(DUSK)).toBeLessThan(brightness(NOON));
    // Never black: the night stays readable.
    expect(brightness(MIDNIGHT)).toBeGreaterThan(brightness(NOON) * 0.3);
  });

  it("is warm at dusk, blue at night, and softer at dawn", () => {
    const warmth = (c: number) => channels(c)[0] - channels(c)[2];
    expect(warmth(lightAt(DUSK, CLEAR).sun.color)).toBeGreaterThan(warmth(0xffe8c8));
    expect(warmth(lightAt(MIDNIGHT, CLEAR).sun.color)).toBeLessThan(0);
    expect(warmth(lightAt(MIDNIGHT, CLEAR).hemi.sky)).toBeLessThan(0);
    expect(warmth(lightAt(DAWN, CLEAR).sun.color)).toBeLessThan(
      warmth(lightAt(DUSK, CLEAR).sun.color),
    );
    // A dark sky overhead at night, and the haze the horizon's own color, so they meet unseen.
    const night = lightAt(MIDNIGHT, CLEAR);
    expect(channels(night.top)[2]).toBeGreaterThan(channels(night.top)[0]);
    expect(channels(night.top).every((c, i) => c < (channels(SKY.topHex)[i] ?? 0) / 2)).toBe(true);
  });

  it("never jumps between one moment and the next, dusk and dawn trading places unseen", () => {
    const steps = 2000;
    for (let i = 0; i < steps; i++) {
      const a = lightAt(i / steps, CLEAR);
      const b = lightAt((i + 1) / steps, CLEAR);
      for (const [x, y] of [
        [a.sun.color, b.sun.color],
        [a.hemi.sky, b.hemi.sky],
        [a.hemi.ground, b.hemi.ground],
        [a.fill.color, b.fill.color],
        [a.top, b.top],
        [a.horizon, b.horizon],
      ] as const) {
        const gap = Math.max(...channels(x).map((c, k) => Math.abs(c - (channels(y)[k] ?? 0))));
        expect(gap, `at ${i / steps}`).toBeLessThanOrEqual(2);
      }
      expect(Math.abs(a.sun.intensity - b.sun.intensity)).toBeLessThan(0.01);
      expect(Math.abs(a.hemi.intensity - b.hemi.intensity)).toBeLessThan(0.01);
      expect(Math.abs(a.glow - b.glow)).toBeLessThan(0.01);
      expect(Math.abs(a.stars - b.stars)).toBeLessThan(0.01);
    }
  });

  it("follows the map's clock: glows when the map's lanterns do, and repeats every day", () => {
    const dayLengthMs = 12_600_000;
    for (let i = 0; i < 200; i++) {
      const at = 1_791_000_000_000 + i * 63_001;
      const phase = dayPhase(at, dayLengthMs);
      const night = nightAmount(phase);
      const { glow } = lightAt(phase, CLEAR);
      if (night <= 0.15) expect(glow).toBe(0);
      else if (night >= 0.75) expect(glow).toBe(1);
      else expect(glow).toBeGreaterThan(0);
      expect(lightAt(dayPhase(at + dayLengthMs, dayLengthMs), CLEAR)).toEqual(
        lightAt(phase, CLEAR),
      );
    }
  });

  it("lights lamps, fires, and windows only after dark, and shows stars only on a clear night", () => {
    expect(lightAt(NOON, CLEAR).glow).toBe(0);
    // Before the map's lanterns come on, nothing glows; by deep evening, everything does.
    const phaseAt = (night: number) => NOON + Math.acos(1 - 2 * night) / (2 * Math.PI);
    expect(lightAt(phaseAt(0.14), CLEAR).glow).toBe(0);
    expect(lightAt(DUSK, CLEAR).glow).toBeGreaterThan(0.4);
    expect(lightAt(DUSK, CLEAR).glow).toBeLessThan(1);
    expect(lightAt(phaseAt(0.76), CLEAR).glow).toBe(1);
    expect(lightAt(MIDNIGHT, CLEAR).glow).toBe(1);
    // Rain or fog never dims a lamp.
    expect(lightAt(MIDNIGHT, WEATHER_LOOK.rain).glow).toBe(1);
    expect(lightAt(DUSK, CLEAR).stars).toBe(0);
    expect(lightAt(MIDNIGHT, CLEAR).stars).toBe(1);
    expect(lightAt(MIDNIGHT, WEATHER_LOOK.cloudy).stars).toBeLessThan(0.3);
    expect(lightAt(MIDNIGHT, WEATHER_LOOK.fog).stars).toBe(0);
  });

  it("greys with the weather, by day and by night", () => {
    const rain = lightAt(NOON, WEATHER_LOOK.rain);
    expect(rain.sun.intensity).toBeCloseTo(2.5 * 0.4);
    expect(rain.hemi.sky).toBe(OVERCAST.light);
    expect(rain.horizon).toBe(OVERCAST.fog);
    expect(rain.reach).toBeCloseTo(0.88);
    const fog = lightAt(NOON, WEATHER_LOOK.fog);
    expect(fog.reach).toBeCloseTo(0.5);
    // And at night too: a rainy night is greyer and no brighter than a clear one.
    expect(brightness(MIDNIGHT, WEATHER_LOOK.rain)).toBeLessThanOrEqual(brightness(MIDNIGHT));
    expect(lightAt(MIDNIGHT, WEATHER_LOOK.rain).falling).not.toBe(0xffffff);
  });
});

describe("Halloween's evenings (RFC 0022)", () => {
  it("leave the day as it is, and tint dusk toward pumpkin and the night sky toward violet", () => {
    expect(lightAt(NOON, CLEAR, "halloween")).toEqual(lightAt(NOON, CLEAR));
    const warmth = (c: number) => channels(c)[0] - channels(c)[1];
    const violet = (c: number) => channels(c)[0] + channels(c)[2] - 2 * channels(c)[1];
    expect(warmth(lightAt(DUSK, CLEAR, "halloween").horizon)).toBeGreaterThan(
      warmth(lightAt(DUSK, CLEAR).horizon),
    );
    expect(violet(lightAt(MIDNIGHT, CLEAR, "halloween").top)).toBeGreaterThan(
      violet(lightAt(MIDNIGHT, CLEAR).top),
    );
    // The light on the ground, and how lamps glow, are the night's own.
    const night = lightAt(MIDNIGHT, CLEAR, "halloween");
    expect(night.sun).toEqual(lightAt(MIDNIGHT, CLEAR).sun);
    expect(night.glow).toBe(lightAt(MIDNIGHT, CLEAR).glow);
  });
});

describe("what glows after dark", () => {
  it("lights the kinds marked to glow, and a window only in a home someone's in", () => {
    for (const kind of ["lantern", "lamp_post", "campfire"] as const)
      expect(glowsAfterDark(kind), kind).toBe(true);
    expect(glowsAfterDark("glass")).toBe(false);
    expect(glowsAfterDark("glass", true)).toBe(true);
    for (const kind of ["wood", "stone", "table", "bench", "fence", "frame"] as const)
      expect(glowsAfterDark(kind, true), kind).toBe(false);
    // The catalog's jack-o'-lantern is marked too, so it needs nothing else.
    expect(glowsAfterDark("jack_o_lantern")).toBe(true);
  });

  it("raises a lamp from its day strength to its night one, wavering a little", () => {
    expect(lampLevel(0.2, 0.9, 0)).toBe(0.2);
    expect(lampLevel(0.2, 0.9, 1)).toBeCloseTo(0.9);
    expect(lampLevel(0.2, 0.9, 0.5)).toBeCloseTo(0.55);
    for (let t = 0; t < 30; t += 0.07) {
      expect(flicker(t, 1)).toBeGreaterThanOrEqual(0.87);
      expect(flicker(t, 1)).toBeLessThanOrEqual(1.13);
    }
    expect(flicker(3, 0)).not.toBe(flicker(3, 2));
  });

  it("lights the homes of those asleep there, and of those standing on their own plot", () => {
    const S = 8;
    const homes = litHomes(
      [
        // Away, so asleep at the hearth on plot (1, 1).
        { online: false, x: 40, y: 40, hearth: { x: 11, y: 11 } },
        // In the world and standing on their own plot (2, 1).
        { online: true, x: 17, y: 9, hearth: { x: 19, y: 11 } },
        // In the world and out: their plot (3, 1) stays dark.
        { online: true, x: 0, y: 0, hearth: { x: 27, y: 11 } },
        // No hearth at all: no home to light.
        { online: false, x: 36, y: 12, hearth: null },
      ],
      S,
    );
    expect([...homes].sort()).toEqual(["1,1", "2,1"]);
  });
});
