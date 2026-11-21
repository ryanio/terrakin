/**
 * Cards on a `workers-cards` renderer. `node.ts` and `worker.ts` each make the renderer from the
 * wasm and fonts their runtime can load; this turns a `Card` into its element tree and size, and
 * draws the paper once.
 */

import { Resvg } from "@resvg/resvg-wasm";
import { type CardRenderer, dataUri, type RenderedCard } from "workers-cards";
import { type Art, type Card, cardSize, element, PAPER_SVG, W } from "./templates";

/** A drawn card: plain data, so it crosses RPC as it is. */
export type Rendered = RenderedCard;

export interface Cards {
  /** The card as SVG, before rasterizing. Tests read it; nothing serves it. */
  svg(card: Card): Promise<string>;
  /** The card as a PNG: 1200x630 for a link card, 1080x1350 for a posted plot photo. */
  render(card: Card): Promise<Rendered>;
}

/**
 * What the cards Worker answers over the `CARDS` service binding (`cloudflare/worker.ts`): a card,
 * drawn, and nothing else. `Card` and `Rendered` are plain data, so both cross RPC as they are.
 */
export type CardDrawer = Pick<Cards, "render">;

/** A scene photo's picture, and the browser it was taken in, left open for the next photo. */
export interface SceneShot {
  png: Uint8Array;
  /** The browser's session, which Browser Run closes once it has sat idle `keepMs`. */
  browser: string;
}

/** How a scene photo is taken: the times are `SCENE_PHOTO_LIMITS`' in the protocol. */
export interface SceneOptions {
  /** How long a new browser's page has to load, and then to say it's ready, each. */
  readyMs: number;
  /** A browser an earlier photo left open, asked first. */
  warm?: string | undefined;
  /** How long the browser in `warm` has to take the photo before a new one is opened. */
  warmTryMs: number;
  /** How long a browser stays open idle after its photo. */
  keepMs: number;
}

/**
 * What the cards Worker draws in a headless browser: a scene photo (RFC 0049), the photo page at
 * `url` on `origin`. Cloudflare only; Node draws scenes with Playwright in the server.
 */
export interface SceneDrawer {
  scene(url: string, origin: string, o: SceneOptions): Promise<SceneShot>;
}

/** The cards drawn by `renderer`, whose engine has booted resvg by the time `ready()` settles. */
export function cardsFrom(renderer: CardRenderer): Cards {
  let paper: Promise<Art> | undefined;
  // The grain filter is the slowest thing on a card, so draw the paper once and reuse it.
  const art = () => {
    paper ??= renderer.ready().then(() => ({ paper: dataUri("image/png", rasterize(PAPER_SVG)) }));
    paper.catch(() => {
      paper = undefined;
    });
    return paper;
  };
  return {
    svg: async (card) => renderer.svg(element(card, await art()), cardSize(card)),
    render: async (card) => renderer.png(element(card, await art()), cardSize(card)),
  };
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
