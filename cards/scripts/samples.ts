/**
 * Writes every sample card as a PNG to a directory, so you can look at them.
 *
 *   pnpm --filter @terrakin/cards samples /tmp/cards
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-wasm";
import { cards } from "../src/node";
import { samples } from "../src/samples";

const dir = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? "card-samples");
mkdirSync(dir, { recursive: true });

// Sample pictures, drawn here so the repo needs no binary fixtures. Rendered after the first card
// so the wasm is ready.
const picture = (svg: string, width: number) => {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
};

await cards.render({ kind: "site" });
const images = {
  avatar: picture(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#cfe3b5"/><circle cx="50" cy="42" r="20" fill="#8f3d20"/><rect x="22" y="66" width="56" height="40" rx="20" fill="#5e7f45"/></svg>',
    400,
  ),
  photo: picture(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#bfe0f2"/><circle cx="124" cy="30" r="14" fill="#f2b84b"/><path d="M0 82 Q40 60 80 78 T160 70 V120 H0z" fill="#8fb36a"/><path d="M50 84 l20 -18 l20 18 v22 h-40z" fill="#fffaf0" stroke="#2b2620" stroke-width="2"/><path d="M46 86 l24 -22 l24 22" fill="none" stroke="#b4532f" stroke-width="5" stroke-linejoin="round"/></svg>',
    1200,
  ),
};

for (const [name, card] of samples(images)) {
  const started = performance.now();
  const { bytes } = await cards.render(card);
  const file = join(dir, `og-${name}.png`);
  writeFileSync(file, bytes);
  console.log(
    `${file}  ${(bytes.length / 1024).toFixed(0)} KB  ${(performance.now() - started).toFixed(0)} ms`,
  );
}
