/**
 * Postcards and avatars for the townsfolk. Each postcard shows the persona's own building
 * (buildings.ts) on the brand mark's plot of earth, in the mark's outline weight and palette.
 * Each avatar is the resident's token with a face and a hat that fits the character.
 */
import {
  fmt,
  GRAIN,
  MARK,
  PALETTE,
  png,
  svgDoc,
  type TextPath,
  type Typeset,
  withTypesetter,
} from "../brand/logo.ts";
import { BUILDINGS } from "./buildings.ts";
import { Drawing, mix, slab, TILE } from "./iso.ts";
import type { Accent, Persona, Sky } from "./personas.ts";

export { mix };

/**
 * Bump when the art changes enough that the live townsfolk should get it: `seed.ts --refresh-art`
 * replaces avatars and postcard posts drawn with an older version, and does nothing otherwise.
 */
export const ART_VERSION = 2;

/** Resident colors, the same as the world client's (packages/client/src/render.ts). */
export const RESIDENT_HEX = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
  sand: "#e2c993",
  coal: "#4a443d",
  snow: "#fbf7ee",
} as const;

const SKIES: Record<Sky, { bg: string; edge: string; ink: string; grain: boolean }> = {
  day: { bg: PALETTE.paper, edge: PALETTE.paperEdge, ink: PALETTE.ink, grain: true },
  dusk: { bg: "#fbe3cf", edge: "#efc4a4", ink: PALETTE.ink, grain: true },
  night: { bg: "#2d3350", edge: "#4a5478", ink: PALETTE.paper, grain: false },
};

/** Largest file the seed will upload. The server allows 5 MB; small keeps the feed light. */
export const MAX_IMAGE_BYTES = 300_000;

/** Postcard size, and the part of it that survives the feed's crops. */
export const POSTCARD = { width: 960, height: 600 } as const;
/**
 * The 2x2 grid in the feed shows each image at about 4:3, which keeps the middle 800 of the 960
 * pixels. Everything that matters (the home, the words, the stamp, the address) stays inside this.
 */
export const SAFE = { x0: 100, x1: 860 } as const;

function accents(list: Accent[], sky: Sky): string {
  const out: string[] = [];
  const cloud = (x: number, y: number, s: number) =>
    `<g fill="#ffffff" fill-opacity="${sky === "day" ? 0.95 : 0.8}" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="16"/><ellipse cx="-16" cy="-8" rx="18" ry="16"/><ellipse cx="12" cy="-14" rx="20" ry="18"/></g>`;
  const bird = (x: number, y: number, s: number) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M-14 0Q-7 -9 0 0Q7 -9 14 0" fill="none" stroke="${sky === "night" ? PALETTE.paper : PALETTE.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const star = (x: number, y: number, r: number) =>
    `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${PALETTE.sun}"/>`;
  for (const a of list) {
    if (a === "sun") {
      out.push(
        `<circle cx="150" cy="110" r="50" fill="${PALETTE.sun}" fill-opacity="0.25"/><circle cx="150" cy="110" r="33" fill="${PALETTE.sun}"/>`,
      );
    } else if (a === "moon") {
      const bg = SKIES[sky].bg;
      out.push(
        `<circle cx="150" cy="108" r="32" fill="#fff4cf"/><circle cx="166" cy="96" r="28" fill="${bg}"/>`,
      );
    } else if (a === "clouds") {
      out.push(cloud(600, 84, 1), cloud(450, 120, 0.7));
    } else if (a === "birds") {
      out.push(bird(640, 128, 1), bird(672, 106, 0.75), bird(612, 98, 0.6));
    } else if (a === "stars") {
      for (const [x, y, r] of [
        [440, 70, 9],
        [520, 140, 6],
        [620, 64, 10],
        [700, 160, 6],
        [120, 230, 6],
        [400, 180, 5],
        [130, 470, 7],
        [560, 520, 5],
        [800, 220, 5],
      ] as const) {
        out.push(star(x, y, r));
      }
    }
  }
  return out.join("");
}

/** Greedy word wrap using real glyph widths. */
function wrap(
  type: Typeset,
  text: string,
  weight: number,
  size: number,
  max: number,
  italic = false,
) {
  const lines: TextPath[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && type(next, weight, size, italic).w > max) {
      lines.push(type(current, weight, size, italic));
      current = word;
    } else current = next;
  }
  lines.push(type(current, weight, size, italic));
  return lines;
}

/** The persona's home on its plot of earth, as SVG elements in drawing units, and its bounds. */
export function homeDrawing(p: Persona): { svg: string; bounds: ReturnType<Drawing["bounds"]> } {
  const d = new Drawing();
  slab(d);
  BUILDINGS[p.home.building](d, {
    accent: RESIDENT_HEX[p.color],
    night: p.scene.sky === "night",
  });
  return { svg: d.render(`home-${p.key}`), bounds: d.bounds() };
}

/** Drawing units to postcard pixels. The same for every home, so they sit at one scale. */
const HOME_SCALE = 4.6;
/** Where the plot's center sits across the postcard. */
const HOME_X = 308;

/** Where a home drawing lands on the postcard: its box in pixels, and the transform that puts it there. */
export function placeHome(b: { x: number; y: number; w: number; h: number }) {
  const top = Math.max(40, 300 - (b.h * HOME_SCALE) / 2 + 8);
  return {
    x0: HOME_X + b.x * HOME_SCALE,
    x1: HOME_X + (b.x + b.w) * HOME_SCALE,
    y0: top,
    y1: top + b.h * HOME_SCALE,
    /** The bottom of the plot of earth, for the shadow. */
    ground: top + (TILE * (1 + MARK.thickness) - b.y) * HOME_SCALE,
    transform: `translate(${fmt(HOME_X)} ${fmt(top)}) scale(${HOME_SCALE}) translate(0 ${fmt(-b.y)})`,
  };
}

/** A postcard of the persona's home, 960 by 600. */
export function postcardSvg(p: Persona, type: Typeset): string {
  const { width: W, height: H } = POSTCARD;
  const sky = SKIES[p.scene.sky];

  // The home: the plot's center sits at a fixed x; the drawing is centered top to bottom.
  const home = homeDrawing(p);
  const at = placeHome(home.bounds);
  const tf = at.transform;
  const shadow = `<ellipse cx="${fmt(HOME_X)}" cy="${fmt(at.ground + 6)}" rx="${fmt(TILE * HOME_SCALE * 0.72)}" ry="${fmt(TILE * HOME_SCALE * 0.1)}" fill="${sky.edge}"/>`;
  const art = `<g transform="${tf}">${home.svg}</g>`;

  // A stamp in the corner: the resident's color and shape, with a perforated edge.
  const color = RESIDENT_HEX[p.color];
  const sx = SAFE.x1 - 18 - 84;
  const sy = 50;
  const tokenFill = p.color === "snow" ? PALETTE.paper : color;
  const cx = sx + 42;
  const cy = sy + 50;
  const r = 22;
  const token =
    p.shape === "square"
      ? `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" rx="${r * 0.35}"/>`
      : p.shape === "diamond"
        ? `<path d="M${cx} ${cy - r * 1.25}L${cx + r * 1.25} ${cy}L${cx} ${cy + r * 1.25}L${cx - r * 1.25} ${cy}Z"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const stamp =
    `<g transform="rotate(4 ${cx} ${cy})">` +
    `<rect x="${sx}" y="${sy}" width="84" height="100" rx="4" fill="${PALETTE.paper}" stroke="${sky.edge}" stroke-width="6" stroke-dasharray="2 6" stroke-linecap="round"/>` +
    `<rect x="${sx + 8}" y="${sy + 8}" width="68" height="84" rx="3" fill="${p.color === "snow" ? "#e9dfcf" : mix(color, PALETTE.paper, p.color === "coal" ? 0.25 : 0.55)}"/>` +
    `<g fill="${tokenFill}" stroke="${PALETTE.ink}" stroke-width="3" stroke-linejoin="round">${token}</g>` +
    "</g>";

  // Words on the right: the home's name, then "Townsfolk · role", then the address.
  const textX = 520;
  const maxW = SAFE.x1 - 20 - textX;
  const title = wrap(type, p.home.title, 600, 46, maxW);
  const role = wrap(type, `Townsfolk · ${p.role}`, 400, 26, maxW, true);
  const lineGap = 54;
  const roleGap = 36;
  const blockH = title.length * lineGap + role.length * roleGap + 10;
  let y = (H - blockH) / 2 + 66;
  const text: string[] = [];
  for (const line of title) {
    text.push(
      `<path fill="${sky.ink}" transform="translate(${fmt(textX - line.x)} ${fmt(y)})" d="${line.d}"/>`,
    );
    y += lineGap;
  }
  y += 2;
  for (const line of role) {
    text.push(
      `<path fill="${sky.ink}" fill-opacity="0.78" transform="translate(${fmt(textX - line.x)} ${fmt(y)})" d="${line.d}"/>`,
    );
    y += roleGap;
  }
  const address = type("terrakin.org", 400, 20);
  text.push(
    `<path fill="${sky.ink}" fill-opacity="0.6" transform="translate(${fmt(SAFE.x1 - 20 - address.w - address.x)} ${fmt(H - 56)})" d="${address.d}"/>`,
  );
  // Postcard rule lines under the words, like the space for an address.
  const rules = [0, 1]
    .map(
      (i) =>
        `<rect x="${textX}" y="${fmt(y + 6 + i * 28)}" width="${fmt(maxW * (i ? 0.6 : 1))}" height="2" rx="1" fill="${sky.edge}"/>`,
    )
    .join("");

  const frame = `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="26" fill="none" stroke="${sky.edge}" stroke-width="3"/>`;
  const grain = sky.grain ? `<rect width="${W}" height="${H}" filter="url(#grain)"/>` : "";
  return svgDoc(
    W,
    H,
    `<defs>${GRAIN}</defs><rect width="${W}" height="${H}" fill="${sky.bg}"/>${grain}${accents(p.scene.accents, p.scene.sky)}${frame}${stamp}${shadow}${art}${text.join("")}${rules}`,
    `${p.home.title}, a postcard`,
  );
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

const LINE = `stroke="${PALETTE.ink}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;

/** Hats and props, drawn over the face on a 256 by 256 square. */
const HATS: Record<Persona["scene"]["prop"], () => string> = {
  // Juniper: a straw sun hat with a leaf tucked in the band.
  strawHat: () =>
    `<ellipse cx="128" cy="84" rx="100" ry="24" fill="#f3d58a" ${LINE}/>` +
    `<path d="M74 84Q72 30 128 28Q184 30 182 84Z" fill="#f6dd9c" ${LINE}/>` +
    `<path d="M76 70Q128 80 180 70L181 84Q128 94 75 84Z" fill="${PALETTE.moss}" ${LINE}/>` +
    `<path d="M100 44Q128 38 156 44" fill="none" stroke="#d9b462" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M168 76Q196 44 222 58Q204 90 168 76Z" fill="${PALETTE.mossLight}" ${LINE}/>` +
    `<path d="M170 76Q194 64 214 60" fill="none" stroke="${PALETTE.moss}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M164 78Q150 50 164 34Q182 54 164 78Z" fill="${PALETTE.moss}" ${LINE}/>`,
  // Bram: workshop goggles pushed up on the forehead, and a mustache.
  goggles: () =>
    `<path d="M14 92Q128 66 242 92L242 112Q128 86 14 112Z" fill="#6b5a48" ${LINE}/>` +
    `<circle cx="96" cy="88" r="30" fill="#b9873f" ${LINE}/><circle cx="160" cy="88" r="30" fill="#b9873f" ${LINE}/>` +
    `<circle cx="96" cy="88" r="19" fill="#bfe3ef" ${LINE}/><circle cx="160" cy="88" r="19" fill="#bfe3ef" ${LINE}/>` +
    `<path d="M86 82Q90 76 98 76" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/><path d="M150 82Q154 76 162 76" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M126 88L130 88" ${LINE}/>` +
    `<path d="M128 166Q112 154 96 162Q90 176 106 176Q118 174 128 168Q138 174 150 176Q166 176 160 162Q144 154 128 166Z" fill="${PALETTE.clayDeep}" ${LINE}/>`,
  // Clem: a tilted cafe beret with a little heart pin.
  beret: () =>
    `<path d="M58 92Q46 50 108 36Q178 26 200 66Q206 86 180 92Q128 100 58 92Z" fill="#6b4a35" ${LINE}/>` +
    `<path d="M62 90Q128 102 186 90" fill="none" stroke="#4e3526" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M136 34Q138 20 150 16" fill="none" ${LINE}/>` +
    `<path d="M168 64Q168 54 177 56Q184 50 188 60Q190 70 176 78Q166 70 168 64Z" fill="#fff4f0" ${LINE}/>`,
  // Pip: a courier cap with an envelope badge.
  mailCap: () =>
    `<path d="M62 94Q66 34 128 32Q190 34 194 94Z" fill="#2f5d8a" ${LINE}/>` +
    `<path d="M110 94L214 94Q228 106 206 112L110 108Z" fill="#244a70" ${LINE}/>` +
    `<path d="M68 82Q128 92 190 82" fill="none" stroke="#244a70" stroke-width="6"/>` +
    `<circle cx="128" cy="34" r="7" fill="#244a70" ${LINE}/>` +
    `<rect x="104" y="48" width="48" height="32" rx="4" fill="#ffffff" ${LINE}/>` +
    `<path d="M106 51L128 68L150 51" fill="none" ${LINE}/>`,
  // Otis: big round reading glasses and a tuft of hair.
  roundGlasses: () =>
    `<path d="M104 54Q112 30 128 40Q138 24 150 46Q162 38 160 58" fill="none" ${LINE}/>` +
    `<path d="M84 104Q98 96 112 104M144 104Q158 96 172 104" fill="none" ${LINE}/>` +
    `<circle cx="100" cy="140" r="27" fill="#ffffff" fill-opacity="0.25" stroke="#c99a3e" stroke-width="7"/>` +
    `<circle cx="156" cy="140" r="27" fill="#ffffff" fill-opacity="0.25" stroke="#c99a3e" stroke-width="7"/>` +
    `<path d="M124 138Q128 130 132 138" fill="none" stroke="#c99a3e" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M73 134L46 124M183 134L210 124" fill="none" stroke="#c99a3e" stroke-width="6" stroke-linecap="round"/>`,
  // Marlo: a wide-brimmed explorer's hat with a red band and a feather, and freckles.
  explorerHat: () =>
    `<path d="M24 92Q30 74 128 72Q226 74 232 92Q226 104 128 102Q30 104 24 92Z" fill="#8a5a35" ${LINE}/>` +
    `<path d="M70 86Q66 30 128 28Q190 30 186 86Q128 96 70 86Z" fill="#a46d40" ${LINE}/>` +
    `<path d="M71 70Q128 80 185 70L186 86Q128 96 70 86Z" fill="${PALETTE.clay}" ${LINE}/>` +
    `<path d="M128 34Q120 46 128 60" fill="none" stroke="#8a5a35" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M178 74Q206 36 226 26Q220 64 178 74Z" fill="#fff4dd" ${LINE}/>` +
    [
      [72, 160],
      [84, 156],
      [78, 170],
      [184, 160],
      [172, 156],
      [178, 170],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${PALETTE.clayDeep}"/>`)
      .join(""),
  // Sable: a night-blue hood with a star pinned to it.
  starHood: () =>
    `<path fill-rule="evenodd" d="M-10 266L-10 150Q-6 22 128 18Q262 22 266 150L266 266Z M128 72Q56 74 52 150Q56 226 128 230Q200 226 204 150Q200 74 128 72Z" fill="#5c66a6" ${LINE}/>` +
    `<path d="M60 112Q128 56 196 112" fill="none" stroke="#7c86c4" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M196 36L204 56L226 58L209 72L215 94L196 82L177 94L183 72L166 58L188 56Z" fill="${PALETTE.sun}" ${LINE}/>`,
  // Ansel: a floppy painter's beret with a brush tucked in.
  painterBeret: () =>
    `<path d="M92 66L196 14" stroke="${PALETTE.ink}" stroke-width="13" stroke-linecap="round"/>` +
    `<path d="M92 66L182 21" stroke="#c99a68" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M182 21L198 13Q212 8 206 20L194 27Z" fill="${RESIDENT_HEX.sky}" ${LINE}/>` +
    `<path d="M40 96Q20 56 92 38Q170 24 206 62Q218 82 196 94Q128 108 40 96Z" fill="${PALETTE.clay}" ${LINE}/>` +
    `<path d="M48 92Q128 106 196 92" fill="none" stroke="${PALETTE.clayDeep}" stroke-width="8" stroke-linecap="round"/>` +
    `<circle cx="96" cy="60" r="8" fill="${PALETTE.sun}"/><circle cx="120" cy="52" r="6" fill="${RESIDENT_HEX.sky}"/><circle cx="146" cy="58" r="7" fill="${RESIDENT_HEX.leaf}"/>` +
    `<path d="M104 30Q104 18 114 14" fill="none" ${LINE}/>`,
};

/** Background for the avatar: the resident's color, except snow, which needs more contrast on paper. */
function avatarBackground(p: Persona): string {
  const color = RESIDENT_HEX[p.color];
  if (p.color !== "snow") {
    return `<rect width="256" height="256" fill="${color}"/><ellipse cx="88" cy="78" rx="46" ry="28" transform="rotate(-30 88 78)" fill="#ffffff" fill-opacity="0.28"/>`;
  }
  // A painter's canvas: warm linen with paint dabs around the edge.
  const dabs = [
    [30, 150, 26, RESIDENT_HEX.rose],
    [222, 168, 24, RESIDENT_HEX.sky],
    [196, 228, 20, RESIDENT_HEX.leaf],
    [56, 222, 22, PALETTE.sun],
    [236, 110, 14, RESIDENT_HEX.plum],
  ] as const;
  return (
    `<rect width="256" height="256" fill="#e9dfcf"/>` +
    `<circle cx="128" cy="140" r="96" fill="${color}"/>` +
    dabs
      .map(
        ([x, y, r, c]) =>
          `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x + r * 0.9}" cy="${y - r * 0.9}" r="${r * 0.3}" fill="${c}"/>`,
      )
      .join("")
  );
}

/** A square avatar: the resident's color with a friendly face. The client crops it to the shape. */
export function avatarSvg(p: Persona): string {
  const S = 256;
  const dark = p.color === "coal";
  const ink = dark ? PALETTE.paper : PALETTE.ink;
  const cheek = dark ? "#c76b7e" : "#e46f86";
  const parts: string[] = [
    avatarBackground(p),
    `<ellipse cx="100" cy="140" rx="11" ry="13" fill="${ink}"/>`,
    `<ellipse cx="156" cy="140" rx="11" ry="13" fill="${ink}"/>`,
    `<circle cx="104" cy="135" r="3.5" fill="#ffffff"/>`,
    `<circle cx="160" cy="135" r="3.5" fill="#ffffff"/>`,
    `<ellipse cx="78" cy="168" rx="15" ry="9" fill="${cheek}" fill-opacity="0.55"/>`,
    `<ellipse cx="178" cy="168" rx="15" ry="9" fill="${cheek}" fill-opacity="0.55"/>`,
    `<path d="M112 168Q128 184 144 168" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    HATS[p.scene.prop](),
  ];
  return svgDoc(S, S, parts.join(""), `${p.name}, avatar`);
}

export interface Images {
  postcard: Buffer;
  avatar: Buffer;
}

/** Render every persona's postcard and avatar as PNG. */
export function renderAll(personas: Persona[]): Map<string, Images> {
  return withTypesetter([600, 400, "400-italic"], (type) => {
    const out = new Map<string, Images>();
    for (const p of personas) {
      const images = {
        postcard: png(postcardSvg(p, type), POSTCARD.width),
        avatar: png(avatarSvg(p), 256),
      };
      for (const [what, data] of Object.entries(images)) {
        if (data.length > MAX_IMAGE_BYTES) {
          throw new Error(`${p.name}'s ${what} is ${data.length} bytes, over ${MAX_IMAGE_BYTES}`);
        }
      }
      out.set(p.key, images);
    }
    return out;
  });
}
