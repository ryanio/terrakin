/**
 * Evening and night in the 3D views (decision 0098): the light, the sky, and how strongly lamps,
 * fires, and windows glow at a moment of the day. The moment is the map's own (`dayPhase` and
 * `nightAmount` in `time.ts`, decision 0011), so the map, the world in 3D, and a plot in 3D get
 * dark together, and the weather greys it all the way it always has (decision 0073). Plain numbers
 * and no three.js, so tests pin them.
 */
import type { BlockKind, Holiday } from "@terrakin/sim";
import { nightAmount } from "../time";
import type { SkyAmounts } from "../weather";
import { blockLook, mix, OVERCAST, SKY } from "./palette";

/** How the stage is lit at one moment of the day, before the weather. Colors are `0xrrggbb`. */
interface TimeLook {
  /** The sun by day, the moon by night: one light from the same side, so shadows never jump. */
  sun: number;
  sunPower: number;
  /** Light from the sky above and bounced off the ground below. */
  sky: number;
  ground: number;
  skyPower: number;
  /** A soft fill from behind, so shadowed sides never go muddy. */
  fill: number;
  fillPower: number;
  /** The backdrop's top, and its horizon, which is also the haze's color. */
  top: number;
  horizon: number;
  /** The same under cloud, the light from an overcast sky, and the color of mist. */
  overTop: number;
  overHorizon: number;
  overLight: number;
  mist: number;
  /** What rain and snow look like in this light: a color they're multiplied by. */
  falling: number;
}

/** Full day: the storybook light of decision 0030. */
const DAY: TimeLook = {
  sun: 0xffe8c8,
  sunPower: 2.5,
  sky: 0xfff6e8,
  ground: 0x8f8a64,
  skyPower: 1.3,
  fill: 0xd9c8f4,
  fillPower: 0.55,
  top: SKY.topHex,
  horizon: SKY.fog,
  overTop: OVERCAST.top,
  overHorizon: OVERCAST.fog,
  overLight: OVERCAST.light,
  mist: OVERCAST.mist,
  falling: 0xffffff,
};

/** Dusk: a low warm sun, dusky rose light, and a sky going lilac overhead. */
const DUSK: TimeLook = {
  sun: 0xffc2a4,
  sunPower: 1.75,
  sky: 0xe8c6cf,
  ground: 0x6f5d66,
  skyPower: 1.15,
  fill: 0xb4a2e0,
  fillPower: 0.6,
  top: 0xb7a2cb,
  horizon: 0xdcbab5,
  overTop: 0xaea4b6,
  overHorizon: 0xc7b7b4,
  overLight: 0xd8c8ca,
  mist: 0xd8cdcc,
  falling: 0xf2e4e2,
};

/** Dawn: softer than dusk, pink and pale lilac. */
const DAWN: TimeLook = {
  sun: 0xffd3c0,
  sunPower: 1.8,
  sky: 0xf1dae6,
  ground: 0x7b7268,
  skyPower: 1.05,
  fill: 0xc6bdf0,
  fillPower: 0.55,
  top: 0xd1c7e5,
  horizon: 0xf5d8c8,
  overTop: 0xc6c4cf,
  overHorizon: 0xd2cac7,
  overLight: 0xdfd8de,
  mist: 0xe4ddda,
  falling: 0xf6eef0,
};

/** Midnight: a blue moon from the sun's side, a deep indigo sky. */
const NIGHT: TimeLook = {
  sun: 0xb8c0ee,
  sunPower: 1.15,
  sky: 0xa3a6d6,
  ground: 0x4a4560,
  skyPower: 1.4,
  fill: 0x9184c8,
  fillPower: 0.45,
  top: 0x262a52,
  horizon: 0x5c5880,
  overTop: 0x2e3244,
  overHorizon: 0x45485a,
  overLight: 0x7c8098,
  mist: 0x55586a,
  falling: 0x8e9ac0,
};

const KEYS = Object.keys(DAY) as (keyof TimeLook)[];
const POWERS = new Set<keyof TimeLook>(["sunPower", "skyPower", "fillPower"]);

function blend(a: TimeLook, b: TimeLook, t: number): TimeLook {
  const out = { ...a };
  for (const key of KEYS)
    out[key] = POWERS.has(key) ? a[key] + (b[key] - a[key]) * t : mix(a[key], b[key], t);
  return out;
}

/** 0 below `from`, 1 above `to`, and an S-curve between, so nothing starts or stops with a jolt. */
function smooth(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Everything that lights a 3D stage at one moment, in one weather. */
export interface StageLight {
  sun: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  fill: { color: number; intensity: number };
  /** The backdrop's top, and its horizon, which is the haze's color too. */
  top: number;
  horizon: number;
  /** How far the haze reaches, as a share of a clear day's. */
  reach: number;
  /** How strongly lamps, fires, and lit windows glow: 0 by day, 1 after dark. */
  glow: number;
  /** How many stars show: 0 by day, 1 on a clear night. */
  stars: number;
  /** A color rain and snow are multiplied by, so they never glare white in the dark. */
  falling: number;
}

/**
 * Halloween's evenings (RFC 0022): a pumpkin glow low on the horizon through dusk, and a sky that
 * deepens to violet overhead as night falls. Presentation only, from the world's day.
 */
const HALLOWEEN_SKY = { horizon: 0xe58a52, top: 0x4a2a6a, fill: 0xa06ad0 } as const;

/**
 * The light at a moment of the day (`phase`, the map's: 0 dawn, 0.25 noon, 0.5 dusk, 0.75
 * midnight) in some weather, tinted for a `holiday` that has evenings of its own (Halloween). Without
 * a phase (a server with no clock, or the gallery), it's full day.
 *
 * Darkness follows the map's `nightAmount`: day eases into dusk (or dawn) as it reaches one half,
 * and dusk into night as it reaches one, each with an S-curve. Dusk and dawn trade places at noon
 * and midnight, where neither shows, so the light never jumps. The weather greys it on top: cloud
 * dims the sun and greys the sky, fog pales the haze and pulls it in, rain and snow pull it in a
 * little (decision 0073).
 */
export function lightAt(
  phase: number | undefined,
  weather: SkyAmounts,
  holiday?: Holiday,
): StageLight {
  const night = phase === undefined ? 0 : nightAmount(phase);
  // Between noon and midnight the twilight is dusk; between midnight and noon, dawn.
  const p = phase === undefined ? 0.25 : ((phase % 1) + 1) % 1;
  const twilight = p > 0.25 && p < 0.75 ? DUSK : DAWN;
  const t =
    night <= 0.5
      ? blend(DAY, twilight, smooth(0, 0.5, night))
      : blend(twilight, NIGHT, smooth(0.5, 1, night));
  if (holiday === "halloween") {
    // The pumpkin glow is the evening's, never the dawn's; the violet stays all night.
    const evening = twilight === DUSK ? 1 : 0;
    const dusk =
      evening * Math.sin(Math.PI * Math.min(1, night)) * (1 - smooth(0.5, 1, night) * 0.5);
    const deep = smooth(0.45, 1, night);
    t.horizon = mix(t.horizon, HALLOWEEN_SKY.horizon, 0.38 * dusk);
    t.top = mix(t.top, HALLOWEEN_SKY.top, 0.5 * deep);
    t.fill = mix(t.fill, HALLOWEEN_SKY.fill, 0.35 * deep);
  }
  const grey = Math.min(1, weather.cloud * 0.75 + weather.rain * 0.25);
  const mist = weather.fog;
  const tone = (clear: number, overcast: number) =>
    mix(mix(clear, overcast, grey), t.mist, mist * 0.7);
  return {
    sun: {
      color: mix(t.sun, t.overLight, grey * 0.7),
      intensity: t.sunPower * Math.max(0.2, 1 - 0.6 * grey - 0.3 * mist),
    },
    hemi: {
      sky: mix(t.sky, t.overLight, grey),
      ground: t.ground,
      intensity: t.skyPower * (1 + 0.1 * grey),
    },
    fill: { color: t.fill, intensity: t.fillPower * (1 - 0.35 * grey) },
    top: tone(t.top, t.overTop),
    horizon: tone(t.horizon, t.overHorizon),
    reach: 1 - 0.5 * mist - 0.12 * weather.rain - 0.08 * weather.snow,
    // The map's lanterns come on from 0.15 and are full by 0.75; these follow the same ramp.
    glow: smooth(0.15, 0.75, night),
    stars: smooth(0.6, 0.9, night) * (1 - grey) * (1 - mist),
    falling: t.falling,
  };
}

// ---------- what glows ----------

/**
 * Whether a block lights up after dark, read from its look's `glow` mark (`palette.ts`): lamps and
 * fires always, a window only in a home someone's in (`lit`). A new kind marked there glows too.
 */
export function glowsAfterDark(block: BlockKind, lit = false): boolean {
  const glow = blockLook(block).glow;
  return glow !== undefined && (!glow.home || lit);
}

/** A lamp's shade or a flame: how strongly it's lit from inside by day and after dark. */
export function lampLevel(day: number, night: number, glow: number): number {
  return day + (night - day) * glow;
}

/**
 * A flame's waver at `time` seconds, as a share of its strength (about 0.87 to 1.13), so lamps lit
 * at different moments never flicker together (`seed`). Never called with reduced motion: a flame
 * then burns steady.
 */
export function flicker(time: number, seed: number): number {
  return 1 + Math.sin(time * 2.7 + seed) * 0.08 + Math.sin(time * 6.3 + seed * 2.1) * 0.05;
}
