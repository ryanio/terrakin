/**
 * Cards in the Cloudflare Worker. Wrangler bundles a `.wasm` import as a compiled
 * WebAssembly.Module, which a Worker may instantiate (Workers refuse to compile wasm from bytes at
 * run time, hence `satori/standalone` and `init()`), and a `.woff` import as an ArrayBuffer (the
 * `Data` rule in wrangler.jsonc). Keep the font list in step with `fonts.ts`.
 */

import figtree600 from "@fontsource/figtree/files/figtree-latin-600-normal.woff";
import figtree700 from "@fontsource/figtree/files/figtree-latin-700-normal.woff";
import figtree800 from "@fontsource/figtree/files/figtree-latin-800-normal.woff";
import figtreeExt600 from "@fontsource/figtree/files/figtree-latin-ext-600-normal.woff";
import figtreeExt700 from "@fontsource/figtree/files/figtree-latin-ext-700-normal.woff";
import fraunces400 from "@fontsource/fraunces/files/fraunces-latin-400-normal.woff";
import fraunces600 from "@fontsource/fraunces/files/fraunces-latin-600-normal.woff";
import frauncesExt400 from "@fontsource/fraunces/files/fraunces-latin-ext-400-normal.woff";
import frauncesExt600 from "@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import yoga from "satori/yoga.wasm";
import { type Cards, createCards, type FontFile } from "./render";

const fonts: FontFile[] = [
  { name: "Fraunces", weight: 400, data: fraunces400 },
  { name: "Fraunces", weight: 400, data: frauncesExt400 },
  { name: "Fraunces", weight: 600, data: fraunces600 },
  { name: "Fraunces", weight: 600, data: frauncesExt600 },
  { name: "Figtree", weight: 600, data: figtree600 },
  { name: "Figtree", weight: 600, data: figtreeExt600 },
  { name: "Figtree", weight: 700, data: figtree700 },
  { name: "Figtree", weight: 700, data: figtreeExt700 },
  { name: "Figtree", weight: 800, data: figtree800 },
];

export const cards: Cards = createCards(async () => ({ yoga, resvg, fonts }));

export * from "./index";
