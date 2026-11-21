/** Cards in Node (the local server, tests, samples): wasm and fonts read from node_modules. */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori, { init } from "satori/standalone";
import { createRenderer, type ResvgLike } from "workers-cards";
import { FONTS } from "./fonts";
import { type Cards, cardsFrom } from "./render";
import { webpToPng } from "./webp";

const require = createRequire(import.meta.url);

const bytes = (specifier: string) => {
  const b = readFileSync(require.resolve(specifier));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export const cards: Cards = cardsFrom(
  createRenderer(async () => ({
    satori,
    // workers-cards 0.1.0 types the options as `unknown`, which resvg's own class refuses.
    Resvg: Resvg as ResvgLike,
    fonts: FONTS.map((f) => ({ name: f.name, weight: f.weight, data: bytes(f.file) })),
    init: async () => {
      await Promise.all([
        init(bytes("satori/yoga.wasm")),
        initWasm(bytes("@resvg/resvg-wasm/index_bg.wasm")),
      ]);
    },
    decodeWebp: webpToPng(bytes("@jsquash/webp/codec/dec/webp_dec.wasm")),
  })),
);

export * from "./index";
