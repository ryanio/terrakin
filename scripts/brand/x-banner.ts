/**
 * The header image for @TerrakinWorld on X: 1500x500, no words. The brand mark's hearth in the
 * middle and seven townsfolk homes around it, each on its own floating plot of earth, on the
 * site's grained paper under a day sky.
 *
 *   node scripts/brand/x-banner.ts [out.png]
 *
 * X lays the profile picture over the bottom left corner (about the left quarter, the lower third),
 * so nothing sits there. Separate from logo.ts because it draws with the townsfolk kit, which
 * imports logo.ts itself.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDrawing } from "../townsfolk/art.ts";
import { bush, Drawing, mix, slab, TILE } from "../townsfolk/iso.ts";
import { PERSONAS } from "../townsfolk/personas.ts";
import { fmt, GRAIN, MARK, markElements, markSize, PALETTE, png, svgDoc } from "./logo.ts";

const W = 1500;
const H = 500;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "client", "public", "brand", "x-banner.png");

/** Where a plot's center lands, and its scale (drawing units to pixels). Back to front. */
interface Spot {
  x: number;
  y: number;
  s: number;
}

/** Plots with a townsfolk home, by persona key. Scales up to 2 are the far row, drawn first. */
const HOMES: (Spot & { key: string })[] = [
  { key: "ansel", x: 250, y: 170, s: 1.75 },
  { key: "marlo", x: 560, y: 150, s: 1.8 },
  { key: "otis", x: 960, y: 160, s: 1.8 },
  { key: "sable", x: 1250, y: 175, s: 1.75 },
  { key: "juniper", x: 470, y: 320, s: 2.3 },
  { key: "clem", x: 1060, y: 325, s: 2.35 },
  { key: "pip", x: 1340, y: 335, s: 2.15 },
];

/** Small plots with only a bush on them, far back, to fill the sky between the homes. */
const ISLETS: Spot[] = [
  { x: 110, y: 110, s: 0.9 },
  { x: 770, y: 115, s: 0.85 },
  { x: 1440, y: 200, s: 0.8 },
];

/** The hearth from the logo, a little bigger than the rest. */
const HEARTH: Spot = { x: 760, y: 300, s: 2.9 };

/** A plot's center in drawing units: the middle of the tile's top face. */
const CENTER_Y = TILE / 2;
/** From a plot's center down to the bottom of its earth, in drawing units. */
const DEPTH = TILE / 2 + MARK.thickness * TILE;

const shadow = (p: Spot) =>
  `<ellipse cx="${fmt(p.x)}" cy="${fmt(p.y + (DEPTH + 10) * p.s)}" rx="${fmt(TILE * p.s * 0.62)}" ry="${fmt(TILE * p.s * 0.09)}" fill="${PALETTE.paperEdge}" fill-opacity="0.8"/>`;

const place = (p: Spot, body: string) =>
  `<g transform="translate(${fmt(p.x)} ${fmt(p.y)}) scale(${p.s}) translate(0 ${fmt(-CENTER_Y)})">${body}</g>`;

function home(p: Spot & { key: string }): string {
  const persona = PERSONAS.find((x) => x.key === p.key);
  if (!persona) throw new Error(`No townsfolk persona "${p.key}"`);
  return shadow(p) + place(p, homeDrawing(persona).svg);
}

function islet(p: Spot, i: number): string {
  const d = new Drawing();
  slab(d);
  d.piece();
  bush(d, [0.42, 0.58, 0], 0.16);
  if (i % 2) bush(d, [0.7, 0.32, 0], 0.11);
  return shadow(p) + place(p, d.render(`islet-${i}`));
}

function hearth(p: Spot): string {
  const { w, h } = markSize(MARK);
  const width = w * p.s;
  // The mark is drawn by its bounding box: the plot's center sits DEPTH plus the outline above
  // the bottom, and in the middle across.
  const bottom = p.y + (DEPTH + MARK.outline) * p.s;
  return (
    shadow(p) + markElements(MARK, { x: p.x - width / 2, y: bottom - h * p.s, width, id: "hearth" })
  );
}

/** The day sky: a warm wash at the top, the sun, clouds, and a few birds. */
function sky(): { defs: string; body: string } {
  const cloud = (x: number, y: number, s: number) =>
    `<g fill="#ffffff" fill-opacity="0.95" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="16"/><ellipse cx="-16" cy="-8" rx="18" ry="16"/><ellipse cx="12" cy="-14" rx="20" ry="18"/></g>`;
  const bird = (x: number, y: number, s: number) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M-14 0Q-7 -9 0 0Q7 -9 14 0" fill="none" stroke="${PALETTE.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const sun = `<circle cx="1390" cy="84" r="58" fill="${PALETTE.sun}" fill-opacity="0.22"/><circle cx="1390" cy="84" r="37" fill="${PALETTE.sun}"/>`;
  const wash = mix(PALETTE.paper, PALETTE.sun, 0.14);
  return {
    defs: `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wash}"/><stop offset="0.75" stop-color="${PALETTE.paper}"/></linearGradient>`,
    body: [
      `<rect width="${W}" height="${H}" fill="url(#sky)"/>`,
      sun,
      cloud(1190, 74, 1.05),
      cloud(1290, 128, 0.65),
      cloud(380, 70, 0.9),
      cloud(720, 60, 0.6),
      bird(830, 70, 1),
      bird(862, 52, 0.75),
      bird(800, 48, 0.6),
    ].join(""),
  };
}

export function bannerSvg(): string {
  const s = sky();
  const near = HOMES.filter((h) => h.s > 2);
  const far = HOMES.filter((h) => h.s <= 2);
  const scene = [...ISLETS.map(islet), ...far.map(home), ...near.map(home), hearth(HEARTH)].join(
    "",
  );
  return svgDoc(
    W,
    H,
    `<defs>${GRAIN}${s.defs}</defs>${s.body}<rect width="${W}" height="${H}" filter="url(#grain)"/>${scene}`,
    "Terrakin",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : OUT;
  writeFileSync(out, png(bannerSvg(), W));
  console.log(`wrote ${relative(process.cwd(), out)}`);
}
