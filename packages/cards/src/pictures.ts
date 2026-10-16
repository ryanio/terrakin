/**
 * Pictures by link (decision 0160): where a resident is right now (`near`) and how they look
 * (`look`), drawn from data the server builds with the sim's palette and the figure the map draws
 * (`packages/ui/src/figure-svg.ts`). As with plot photos, nothing a resident wrote reaches this
 * markup: names are drawn by the templates as text.
 */
import { safeColor } from "./color";
import { type Drawing, drawingBox, drawingSvg } from "./drawing";
import { areaParts, PET_BOX, type PlotArea, type PlotPet, petSvg } from "./plot";
import type { Sky } from "./sky";

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
  /** The moment it shows: the map's light and the weather over the area. */
  sky: Sky;
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

/** The map around a resident as SVG markup, `width` by `height` pixels. Our own markup only. */
export function nearSvg(c: NearCard, width: number, height: number): string {
  const cols = Math.max(1, Math.min(64, Math.floor(c.area.cols)));
  const rows = Math.max(1, Math.min(64, Math.floor(c.area.rows)));
  const parts = areaParts({
    ...c.area,
    ...(c.at ? { ring: c.at } : {}),
    sky: c.sky,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="xMidYMid slice" shape-rendering="geometricPrecision">${parts.join("")}</svg>`;
}

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
