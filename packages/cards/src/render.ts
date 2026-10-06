/**
 * The renderer, independent of where it runs. `node.ts` and `worker.ts` hand it the wasm and fonts
 * their runtime can load; everything else is shared.
 */

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori, { init as initSatori } from "satori/standalone";
import { type Art, type Card, element, H, PAPER_SVG, W } from "./templates";

/** Whatever each runtime can hand the wasm loaders: bytes in Node, a compiled module in a Worker. */
type Wasm = Parameters<typeof initWasm>[0] & Parameters<typeof initSatori>[0];

/** One font file (WOFF from @fontsource) and how satori should name it. */
export interface FontFile {
  name: "Fraunces" | "Figtree";
  weight: 400 | 600 | 700 | 800;
  data: ArrayBuffer;
}

export interface Engine {
  yoga: Wasm;
  resvg: Wasm;
  fonts: FontFile[];
}

export interface Rendered {
  bytes: Uint8Array;
  type: "image/png";
  width: number;
  height: number;
}

export interface Cards {
  /** The card as SVG, before rasterizing. Tests read it; nothing serves it. */
  svg(card: Card): Promise<string>;
  /** The card as a 1200x630 PNG. */
  render(card: Card): Promise<Rendered>;
}

export function createCards(load: () => Promise<Engine>): Cards {
  let ready: Promise<{ fonts: FontFile[]; art: Art }> | undefined;
  // Once per process or isolate: resvg refuses a second initWasm.
  const boot = () => {
    ready ??= load().then(async (e) => {
      await Promise.all([initSatori(e.yoga), initWasm(e.resvg)]);
      // The grain filter is the slowest thing on a card, so draw the paper once and reuse it.
      const paper = `data:image/png;base64,${base64(rasterize(PAPER_SVG))}`;
      return { fonts: e.fonts, art: { paper } };
    });
    ready.catch(() => {
      ready = undefined;
    });
    return ready;
  };

  async function svg(card: Card): Promise<string> {
    const { fonts, art } = await boot();
    // satori's types want a ReactNode; our plain element objects are what it reads.
    return satori(element(card, art) as unknown as Parameters<typeof satori>[0], {
      width: W,
      height: H,
      fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" })),
    });
  }

  async function render(card: Card): Promise<Rendered> {
    const bytes = rasterize(unmask(await svg(card)));
    return { bytes, type: "image/png", width: W, height: H };
  }

  return { svg, render };
}

/**
 * satori gives every <image> a clip path and a mask of its own box. When that box is a plain
 * rectangle the same size as the image they change nothing, but resvg still draws each mask to an
 * offscreen buffer, which roughly doubles a card's time. Drop just those; rounded ones stay.
 */
export function unmask(svg: string): string {
  const boxes = new Map<string, string>();
  for (const m of svg.matchAll(
    /<(?:mask|clipPath) id="([^"]+)"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"(?: fill="#fff")?\/><\/(?:mask|clipPath)>/g,
  )) {
    boxes.set(m[1] ?? "", `${m[2]} ${m[3]} ${m[4]} ${m[5]}`);
  }
  return svg.replace(
    /<image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"([^>]*)\/>/g,
    (_tag, x: string, y: string, w: string, h: string, rest: string) => {
      const box = `${x} ${y} ${w} ${h}`;
      const attrs = rest.replace(/ (?:clip-path|mask)="url\(#([^)]+)\)"/g, (attr, id: string) =>
        boxes.get(id) === box ? "" : attr,
      );
      return `<image x="${x}" y="${y}" width="${w}" height="${h}"${attrs}/>`;
    },
  );
}

function rasterize(markup: string): Uint8Array {
  const resvg = new Resvg(markup, {
    fitTo: { mode: "width", value: W },
    font: { loadSystemFonts: false },
  });
  try {
    const drawn = resvg.render();
    try {
      return drawn.asPng();
    } finally {
      drawn.free();
    }
  } finally {
    resvg.free();
  }
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
