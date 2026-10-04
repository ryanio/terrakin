/**
 * Postcards and avatars for the townsfolk, drawn with the brand generator's mark so they match the
 * logo: each home is the logo's little house, repainted with the persona's color and materials.
 */
import {
  fmt,
  GRAIN,
  MARK,
  markElements,
  markSize,
  PALETTE,
  type Palette,
  png,
  svgDoc,
  type TextPath,
  type Typeset,
  withTypesetter,
} from "../brand/logo.ts";
import type { Accent, Persona, Sky } from "./personas.ts";

/** Resident colors, the same as the world client's (client/src/render.ts). */
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

/** Front wall and side wall colors for each wall material. */
const WALLS = {
  wood: ["#e8c497", "#c99a68"],
  stone: ["#e6e0d5", "#c2baac"],
  glass: ["#dff0f4", "#b5d8e3"],
  leaf: ["#bcd99c", "#93b974"],
} as const;

/** Window color for each window material. Glass is lit from inside. */
const WINDOWS = { glass: PALETTE.sun, wood: "#d79a55", stone: "#cfc8bb", leaf: "#9cc46e" } as const;

const SKIES: Record<Sky, { bg: string; edge: string; ink: string; grain: boolean }> = {
  day: { bg: PALETTE.paper, edge: PALETTE.paperEdge, ink: PALETTE.ink, grain: true },
  dusk: { bg: "#fbe3cf", edge: "#efc4a4", ink: PALETTE.ink, grain: true },
  night: { bg: "#2d3350", edge: "#4a5478", ink: PALETTE.paper, grain: false },
};

/** Largest file the seed will upload. The server allows 5 MB; small keeps the feed light. */
export const MAX_IMAGE_BYTES = 300_000;

function hex(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two #rrggbb colors, `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

function housePalette(p: Persona): Palette {
  const roof = RESIDENT_HEX[p.color];
  const [wall, wallEdge] = WALLS[p.home.walls];
  return {
    ...PALETTE,
    house: {
      wall,
      wallEdge,
      roof,
      roofDeep: mix(roof, PALETTE.ink, 0.32),
      window: WINDOWS[p.home.windows],
    },
  };
}

function accents(list: Accent[], sky: Sky): string {
  const out: string[] = [];
  const cloud = (x: number, y: number, s: number) =>
    `<g fill="#ffffff" fill-opacity="${sky === "day" ? 0.95 : 0.8}" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="16"/><ellipse cx="-16" cy="-8" rx="18" ry="16"/><ellipse cx="12" cy="-14" rx="20" ry="18"/></g>`;
  const bird = (x: number, y: number, s: number) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M-14 0Q-7 -9 0 0Q7 -9 14 0" fill="none" stroke="${PALETTE.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const star = (x: number, y: number, r: number) =>
    `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${PALETTE.sun}"/>`;
  for (const a of list) {
    if (a === "sun") {
      out.push(
        `<circle cx="96" cy="96" r="52" fill="${PALETTE.sun}" fill-opacity="0.25"/><circle cx="96" cy="96" r="34" fill="${PALETTE.sun}"/>`,
      );
    } else if (a === "moon") {
      const bg = SKIES[sky].bg;
      out.push(
        `<circle cx="100" cy="98" r="32" fill="#fff4cf"/><circle cx="116" cy="86" r="28" fill="${bg}"/>`,
      );
    } else if (a === "clouds") {
      out.push(cloud(470, 92, 1.1), cloud(300, 66, 0.75));
    } else if (a === "birds") {
      out.push(bird(580, 116, 1), bird(612, 94, 0.75), bird(552, 86, 0.6));
    } else if (a === "stars") {
      for (const [x, y, r] of [
        [190, 70, 9],
        [300, 120, 6],
        [420, 64, 10],
        [520, 130, 6],
        [60, 200, 6],
        [250, 40, 5],
        [600, 70, 7],
        [470, 190, 5],
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

/** A postcard of the persona's home, 960 by 600. */
export function postcardSvg(p: Persona, type: Typeset): string {
  const W = 960;
  const H = 600;
  const sky = SKIES[p.scene.sky];
  const { w, h } = markSize(MARK);
  const markW = 380;
  const markH = (markW * h) / w;
  const markX = 84;
  const markY = (H - markH) / 2 + 30;
  const mark = markElements(MARK, {
    x: markX,
    y: markY,
    width: markW,
    id: `home-${p.key}`,
    palette: housePalette(p),
  });
  const shadow = `<ellipse cx="${fmt(markX + markW / 2)}" cy="${fmt(markY + markH + 4)}" rx="${fmt(markW * 0.36)}" ry="${fmt(markW * 0.05)}" fill="${sky.edge}"/>`;

  // A stamp in the corner: the resident's color and shape, with a perforated edge.
  const color = RESIDENT_HEX[p.color];
  const sx = W - 60 - 84;
  const sy = 56;
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
    `<rect x="${sx + 8}" y="${sy + 8}" width="68" height="84" rx="3" fill="${mix(color, PALETTE.paper, p.color === "coal" ? 0.25 : 0.55)}"/>` +
    `<g fill="${tokenFill}" stroke="${PALETTE.ink}" stroke-width="3" stroke-linejoin="round">${token}</g>` +
    "</g>";

  // Words on the right: the home's name, then "Townsfolk · role", then the address.
  const textX = 520;
  const maxW = W - textX - 70;
  const title = wrap(type, p.home.title, 600, 50, maxW);
  const role = wrap(type, `Townsfolk · ${p.role}`, 400, 28, maxW, true);
  const lineGap = 58;
  const roleGap = 40;
  const blockH = title.length * lineGap + role.length * roleGap + 10;
  let y = (H - blockH) / 2 + 62;
  const text: string[] = [];
  for (const line of title) {
    text.push(
      `<path fill="${sky.ink}" transform="translate(${fmt(textX - line.x)} ${fmt(y)})" d="${line.d}"/>`,
    );
    y += lineGap;
  }
  y += 4;
  for (const line of role) {
    text.push(
      `<path fill="${sky.ink}" fill-opacity="0.78" transform="translate(${fmt(textX - line.x)} ${fmt(y)})" d="${line.d}"/>`,
    );
    y += roleGap;
  }
  const address = type("terrakin.org", 400, 20);
  text.push(
    `<path fill="${sky.ink}" fill-opacity="0.55" transform="translate(${fmt(W - 70 - address.w - address.x)} ${fmt(H - 58)})" d="${address.d}"/>`,
  );
  // Postcard rule lines under the words, like the space for an address.
  const rules = [0, 1]
    .map(
      (i) =>
        `<rect x="${textX}" y="${fmt(y + 8 + i * 30)}" width="${fmt(maxW * (i ? 0.6 : 1))}" height="2" rx="1" fill="${sky.edge}"/>`,
    )
    .join("");

  const frame = `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="26" fill="none" stroke="${sky.edge}" stroke-width="3"/>`;
  const grain = sky.grain ? `<rect width="${W}" height="${H}" filter="url(#grain)"/>` : "";
  return svgDoc(
    W,
    H,
    `<defs>${GRAIN}</defs><rect width="${W}" height="${H}" fill="${sky.bg}"/>${grain}${accents(p.scene.accents, p.scene.sky)}${frame}${stamp}${shadow}${mark}${text.join("")}${rules}`,
    `${p.home.title}, a postcard`,
  );
}

/** A square avatar: the resident's color with a friendly face. The client crops it to the shape. */
export function avatarSvg(p: Persona): string {
  const S = 256;
  const color = RESIDENT_HEX[p.color];
  const dark = p.color === "coal";
  const ink = dark ? PALETTE.paper : PALETTE.ink;
  const cheek = dark ? "#c76b7e" : "#e46f86";
  const parts: string[] = [
    `<rect width="${S}" height="${S}" fill="${color}"/>`,
    `<ellipse cx="88" cy="78" rx="46" ry="28" transform="rotate(-30 88 78)" fill="#ffffff" fill-opacity="0.28"/>`,
    `<ellipse cx="100" cy="132" rx="11" ry="13" fill="${ink}"/>`,
    `<ellipse cx="156" cy="132" rx="11" ry="13" fill="${ink}"/>`,
    `<circle cx="104" cy="127" r="3.5" fill="#ffffff"/>`,
    `<circle cx="160" cy="127" r="3.5" fill="#ffffff"/>`,
    `<ellipse cx="78" cy="160" rx="15" ry="9" fill="${cheek}" fill-opacity="0.55"/>`,
    `<ellipse cx="178" cy="160" rx="15" ry="9" fill="${cheek}" fill-opacity="0.55"/>`,
    `<path d="M112 160Q128 176 144 160" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
  ];
  const line = `stroke="${PALETTE.ink}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
  switch (p.scene.prop) {
    case "sprig":
      parts.push(
        `<path d="M128 70Q126 52 132 40" fill="none" ${line}/>`,
        `<path d="M131 48Q112 30 98 44Q114 58 131 48Z" fill="${PALETTE.moss}" ${line}/>`,
        `<path d="M131 46Q148 24 164 36Q150 56 131 46Z" fill="${PALETTE.mossLight}" ${line}/>`,
      );
      break;
    case "mustache":
      parts.push(
        `<path d="M128 152Q112 142 98 150Q92 162 106 162Q118 160 128 154Q138 160 150 162Q164 162 158 150Q144 142 128 152Z" fill="${PALETTE.clayDeep}" ${line}/>`,
      );
      break;
    case "bow":
      parts.push(
        `<path d="M128 58L96 40Q86 58 96 76Z" fill="${PALETTE.clay}" ${line}/>`,
        `<path d="M128 58L160 40Q170 58 160 76Z" fill="${PALETTE.clay}" ${line}/>`,
        `<circle cx="128" cy="58" r="9" fill="${PALETTE.clayDeep}" ${line}/>`,
      );
      break;
    case "cap":
      parts.push(
        `<path d="M70 82Q74 34 128 32Q182 34 186 82Z" fill="${PALETTE.clay}" ${line}/>`,
        `<path d="M150 82L206 82Q214 92 200 96L150 96Z" fill="${PALETTE.clayDeep}" ${line}/>`,
        `<circle cx="128" cy="34" r="7" fill="${PALETTE.clayDeep}" ${line}/>`,
      );
      break;
    case "glasses":
      parts.push(
        `<circle cx="100" cy="132" r="24" fill="#ffffff" fill-opacity="0.18" ${line}/>`,
        `<circle cx="156" cy="132" r="24" fill="#ffffff" fill-opacity="0.18" ${line}/>`,
        `<path d="M124 130Q128 124 132 130" fill="none" ${line}/>`,
      );
      break;
    case "freckles":
      for (const [x, y] of [
        [70, 150],
        [82, 146],
        [76, 160],
        [186, 150],
        [174, 146],
        [180, 160],
      ] as const) {
        parts.push(`<circle cx="${x}" cy="${y}" r="3" fill="${PALETTE.clayDeep}"/>`);
      }
      parts.push(
        `<path d="M60 70Q128 20 196 70" fill="none" stroke="${PALETTE.clay}" stroke-width="14" stroke-linecap="round"/>`,
      );
      break;
    case "star":
      parts.push(
        `<path d="M176 40L184 60L206 62L189 76L195 98L176 86L157 98L163 76L146 62L168 60Z" fill="${PALETTE.sun}" ${line}/>`,
      );
      break;
    case "beret":
      parts.push(
        `<path d="M66 84Q60 40 120 34Q186 30 192 70Q180 86 128 86Q86 88 66 84Z" fill="${PALETTE.clay}" ${line}/>`,
        `<path d="M124 34Q124 24 132 20" fill="none" ${line}/>`,
      );
      break;
  }
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
      const images = { postcard: png(postcardSvg(p, type), 960), avatar: png(avatarSvg(p), 256) };
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
