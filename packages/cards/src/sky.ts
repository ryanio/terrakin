/**
 * The sky over a picture of the world: the weather held still and the map's light at a moment.
 * Every picture drawn from above shares it, so a plot photo, a plot by link and the map around
 * someone all show the same hour and the same weather (decision 0300).
 *
 * Flat washes, one gradient, and a fixed scatter of rain or snow. No filters: a filter is a blur
 * per card, and a card has about 100 ms to draw.
 */

export const WEATHERS = ["clear", "cloudy", "rain", "fog", "snow"] as const;
export type PictureWeather = (typeof WEATHERS)[number];

/** The moment a picture was taken: how dark it is, and what the weather was doing. */
export interface Sky {
  /** How dark it is: 0 at noon, 1 at midnight, as the map's light. */
  night: number;
  weather: PictureWeather;
}

const n = (v: number) => Number(v.toFixed(3));

/** A small, fixed sequence of numbers in [0, 1), so rain and snow fall the same way every time. */
function scatter(count: number, seed: number): number[] {
  let s = seed >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(s / 2 ** 32);
  }
  return out;
}

/** The weather over an area, as the map draws it held still: a wash, then rain or snow. */
function weatherSvg(weather: PictureWeather, cols: number, rows: number): string[] {
  const all = `x="0" y="0" width="${cols}" height="${rows}"`;
  switch (weather) {
    case "cloudy":
      return [`<rect ${all} fill="rgba(96, 104, 122, 0.14)"/>`];
    case "fog":
      return [`<rect ${all} fill="rgba(232, 234, 238, 0.38)"/>`];
    case "rain": {
      const count = Math.round(cols * rows * 0.35);
      const r = scatter(count * 2, 7);
      let d = "";
      for (let i = 0; i < count; i++) {
        const x = (r[i * 2] ?? 0) * cols;
        const y = (r[i * 2 + 1] ?? 0) * rows;
        d += `M${n(x)} ${n(y)}l-0.12 0.36`;
      }
      return [
        `<rect ${all} fill="rgba(70, 88, 118, 0.18)"/>`,
        `<path d="${d}" stroke="rgba(214, 228, 244, 0.6)" stroke-width="0.035" stroke-linecap="round" fill="none"/>`,
      ];
    }
    case "snow": {
      const count = Math.round(cols * rows * 0.5);
      const r = scatter(count * 3, 11);
      const flakes: string[] = [];
      for (let i = 0; i < count; i++) {
        const x = (r[i * 3] ?? 0) * cols;
        const y = (r[i * 3 + 1] ?? 0) * rows;
        const size = 0.035 + (r[i * 3 + 2] ?? 0) * 0.05;
        flakes.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(size)}"/>`);
      }
      return [
        `<rect ${all} fill="rgba(232, 238, 246, 0.12)"/>`,
        `<g fill="rgba(255, 255, 255, 0.9)">${flakes.join("")}</g>`,
      ];
    }
    default:
      return [];
  }
}

/**
 * The map's light held still, as `packages/client/src/render.ts` paints it: a warm glaze at dawn
 * and dusk, then night as a multiply that keeps every hue (a clay roof stays warm) under a thin
 * violet glaze, and hearths glowing after dark. The multiply is what keeps a dusk photo from going
 * grey, so it has to fall on everything in the picture: see `NIGHT_WASH` for the one piece drawn
 * over it.
 */
function lightSvg(
  night: number,
  hearths: readonly { x: number; y: number }[],
  cols: number,
  rows: number,
): string[] {
  const k = clamp(night);
  const all = `x="0" y="0" width="${cols}" height="${rows}"`;
  const out: string[] = [];
  const golden = Math.sin(Math.PI * k);
  if (golden > 0.02) out.push(`<rect ${all} fill="rgba(242, 146, 82, ${n(0.13 * golden)})"/>`);
  if (k > 0.02) {
    out.push(
      `<rect ${all} fill="${multiplyTone(k)}" style="mix-blend-mode:multiply"/>`,
      `<rect ${all} fill="rgba(84, 62, 168, ${n(0.14 * k)})"/>`,
    );
  }
  if (k > 0.25) {
    const strength = (k - 0.25) / 0.75;
    out.push(
      `<defs><radialGradient id="glow"><stop offset="0" stop-color="#f2aa50" stop-opacity="${n(0.5 * strength)}"/><stop offset="1" stop-color="#f2aa50" stop-opacity="0"/></radialGradient></defs>`,
    );
    for (const h of hearths.slice(0, 64)) {
      if (![h.x, h.y].every(Number.isFinite)) continue;
      out.push(`<circle cx="${n(h.x + 0.5)}" cy="${n(h.y + 0.5)}" r="2.4" fill="url(#glow)"/>`);
    }
  }
  return out;
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** The night's multiply color, capped as the map caps it so the world stays readable at midnight. */
function multiplyTone(night: number): string {
  const k = night * 0.78;
  const part = (loss: number) => Math.round(255 - k * loss);
  return `rgb(${part(143)}, ${part(151)}, ${part(59)})`;
}

/**
 * The same light as a flat wash, for the one thing a picture draws over the plot rather than in it:
 * the owner's own picture of their home, which the card lays over the hearth. Nothing can multiply
 * there, so the wash darkens by what the night takes from the green channel and tints violet, which
 * leaves the home picture in the same light as the plot under it.
 */
export function nightWash(sky: Sky | undefined): string | undefined {
  const k = sky ? clamp(sky.night) : 0;
  if (k <= 0.02) return undefined;
  return `rgba(26, 18, 54, ${n(Math.min(0.72, 0.78 * k * (151 / 255) + 0.08 * k))})`;
}

/**
 * The sky over an area in tile units, drawn over everything standing in it: the weather first, then
 * the light, with the hearths that glow after dark. Our own markup only.
 */
export function skyParts(
  sky: Sky,
  hearths: readonly { x: number; y: number }[],
  cols: number,
  rows: number,
): string[] {
  const weather = (WEATHERS as readonly string[]).includes(sky.weather) ? sky.weather : "clear";
  return [
    ...weatherSvg(weather as PictureWeather, cols, rows),
    ...lightSvg(sky.night, hearths, cols, rows),
  ];
}
