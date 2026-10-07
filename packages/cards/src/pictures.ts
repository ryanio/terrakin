/**
 * Pictures by link (decision 0160): where a resident is right now (`near`) and how they look
 * (`look`), drawn from data the server builds with the sim's palette and the figure the map draws
 * (`packages/ui/src/figure-svg.ts`). As with plot photos, nothing a resident wrote reaches this
 * markup: names are drawn by the templates as text.
 */
import { safeColor } from "./color";
import { type Drawing, drawingBox, drawingSvg } from "./drawing";
import { areaParts, type PlotArea, type PlotPet, petSvg } from "./plot";

export const WEATHERS = ["clear", "cloudy", "rain", "fog", "snow"] as const;
export type PictureWeather = (typeof WEATHERS)[number];

/** The map around a resident: the world's ground and builds, who's nearby, the light and sky. */
export interface NearCard {
  kind: "near";
  /** Whose spot it is. Untrusted: drawn as text, or "A resident" when nothing in it can be drawn. */
  name: string;
  /** Where it is, in our own words, like "Beside plot 3, 2" or "In the Commons". */
  place: string;
  /** Short lines in our own words, like "Dusk", "Rain", "3 nearby". */
  facts: string[];
  area: PlotArea;
  /** Where they stand, in tiles from the area's top left, ringed on the ground under them. */
  at?: { x: number; y: number } | undefined;
  /** How dark it is: 0 at noon, 1 at midnight, as the map's light. */
  night: number;
  weather: PictureWeather;
}

/** A resident in their look, standing on a patch of their theme's ground, with their pet. */
export interface LookCard {
  kind: "look";
  /** Untrusted: drawn as text, or "A resident" when nothing in it can be drawn. */
  name: string;
  agent?: boolean | undefined;
  townsfolk?: boolean | undefined;
  figure: Drawing;
  /** Their pet as the sim's shapes, sitting beside them. */
  pet?: Pick<PlotPet, "shapes" | "flip"> | undefined;
  /** The patch of ground under them: their theme's ground color. */
  ground: string;
  /** Short lines in our own words about the look, like "Lemon outfit" or "Auburn bob". */
  facts: string[];
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

/** The sky over an area, as the map draws it held still: a wash, then rain or snow. */
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
 * The map's light held still: a warm glaze at dawn and dusk, a dusky violet over the night, and
 * hearths glowing after dark. Flat washes and one gradient, no filters.
 */
function lightSvg(night: number, a: PlotArea, cols: number, rows: number): string[] {
  const k = Number.isFinite(night) ? Math.max(0, Math.min(1, night)) : 0;
  const all = `x="0" y="0" width="${cols}" height="${rows}"`;
  const out: string[] = [];
  const golden = Math.sin(Math.PI * k);
  if (golden > 0.02) out.push(`<rect ${all} fill="rgba(242, 146, 82, ${n(0.13 * golden)})"/>`);
  if (k > 0.02) out.push(`<rect ${all} fill="rgba(48, 36, 120, ${n(0.46 * k)})"/>`);
  if (k > 0.25) {
    const strength = (k - 0.25) / 0.75;
    out.push(
      `<defs><radialGradient id="glow"><stop offset="0" stop-color="#f2aa50" stop-opacity="${n(0.5 * strength)}"/><stop offset="1" stop-color="#f2aa50" stop-opacity="0"/></radialGradient></defs>`,
    );
    for (const h of (a.hearths ?? []).slice(0, 64)) {
      if (![h.x, h.y].every(Number.isFinite)) continue;
      out.push(`<circle cx="${n(h.x + 0.5)}" cy="${n(h.y + 0.5)}" r="2.4" fill="url(#glow)"/>`);
    }
  }
  return out;
}

/** The map around a resident as SVG markup, `width` by `height` pixels. Our own markup only. */
export function nearSvg(c: NearCard, width: number, height: number): string {
  const cols = Math.max(1, Math.min(64, Math.floor(c.area.cols)));
  const rows = Math.max(1, Math.min(64, Math.floor(c.area.rows)));
  const ring =
    c.at && Number.isFinite(c.at.x) && Number.isFinite(c.at.y)
      ? `<ellipse cx="${n(c.at.x)}" cy="${n(c.at.y)}" rx="0.46" ry="0.17" fill="none" stroke="#ffffff" stroke-width="0.07" stroke-opacity="0.9"/>`
      : "";
  // The ring goes on the ground: after the ground and builds, under the figures. `areaParts` puts
  // figures last, so draw the area without them, the ring, then the figures on their own.
  const ground = areaParts({ ...c.area, figures: [] });
  const standing = areaParts({
    cols,
    rows,
    ground: [],
    blocks: [],
    figures: c.area.figures,
    ink: c.area.ink,
  });
  const weather = (WEATHERS as readonly string[]).includes(c.weather) ? c.weather : "clear";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="xMidYMid slice" shape-rendering="geometricPrecision">${ground.join("")}${ring}${standing.join("")}${weatherSvg(weather, cols, rows).join("")}${lightSvg(c.night, c.area, cols, rows).join("")}</svg>`;
}

/** The side of a pet picture's box in the sim's own units. */
const PET_BOX = 48;

/**
 * A resident in their look as SVG markup, `width` by `height` pixels: a patch of ground, a soft
 * shadow, the figure, and their pet sitting beside them. Our own markup only.
 */
export function lookSvg(c: LookCard, width: number, height: number): string {
  const box = drawingBox(c.figure);
  const figure = box ? drawingSvg(c.figure, "f") : "";
  const pet = c.pet && Array.isArray(c.pet.shapes) ? c.pet : undefined;
  // The figure's units: 100 to a tile, feet at 0, 0. The pet sits to its right, two thirds of a
  // tile across, its feet on the same ground.
  const petSize = 66;
  const petMarkup = pet
    ? petSvg({ x: 0, y: 0, size: 1, shapes: pet.shapes, flip: pet.flip }, 2, 2)
    : [];
  const view = pet ? [-78, -124, 196, 146] : [-78, -124, 156, 146];
  const groundFill = safeColor(c.ground);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view.join(" ")}" shape-rendering="geometricPrecision">`,
    `<ellipse cx="${pet ? 20 : 0}" cy="2" rx="${pet ? 90 : 66}" ry="16" fill="${groundFill}" opacity="0.55"/>`,
    `<ellipse cx="0" cy="0" rx="27" ry="8.5" fill="rgba(60, 40, 20, 0.2)"/>`,
    figure,
    pet
      ? `<ellipse cx="${n(46 + petSize / 2)}" cy="0" rx="${n(petSize * 0.32)}" ry="5" fill="rgba(60, 40, 20, 0.18)"/><g transform="translate(46 ${n(-petSize * (42.5 / PET_BOX))}) scale(${petSize})">${petMarkup.join("")}</g>`
      : "",
    "</svg>",
  ].join("");
}
