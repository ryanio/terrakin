/** Cards in Node (the local server, tests, samples): wasm and fonts read from node_modules. */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { FONTS } from "./fonts";
import { type Cards, createCards } from "./render";

const require = createRequire(import.meta.url);

const bytes = (specifier: string) => {
  const b = readFileSync(require.resolve(specifier));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export const cards: Cards = createCards(async () => ({
  yoga: bytes("satori/yoga.wasm"),
  resvg: bytes("@resvg/resvg-wasm/index_bg.wasm"),
  fonts: FONTS.map((f) => ({ ...f, data: bytes(f.file) })),
}));

export * from "./index";
