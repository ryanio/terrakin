/**
 * What the app's first load holds (decisions 0110 and 0258): builds the client in memory and
 * prints the gzipped size of the entry script with every chunk it imports up front, the number the
 * build checks against `FIRST_LOAD_BUDGET`, then the packages and the modules that make it up, by
 * their minified size.
 *
 *   node scripts/first-load.ts [--top 40]
 *
 *   --top  how many modules to list (default 40; 0 for none)
 *
 * Run it before and after a change to the first load. A module's size here is what is left of it
 * after tree shaking and minifying. Gzip is measured on whole chunks only, since a module alone
 * compresses differently than it does among the rest.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

/** The parts of a built chunk this reads. */
type Chunk = {
  type: "chunk";
  fileName: string;
  code: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  modules: Record<string, { renderedLength: number }>;
};
type Output = { output: readonly (Chunk | { type: "asset" })[] };
type Vite = {
  build(config: {
    root: string;
    configFile: string;
    configLoader: "runner";
    logLevel: "silent";
    build: { write: false };
  }): Promise<Output | Output[]>;
};

const { values } = parseArgs({ options: { top: { type: "string", default: "40" } } });
const top = Number(values.top);
if (!Number.isInteger(top) || top < 0) {
  console.error("--top takes a whole number");
  process.exit(2);
}

const client = fileURLToPath(new URL("../packages/client/", import.meta.url));
// Vite is the client's dependency, and its config reads files beside itself.
const vitePath = createRequire(`${client}package.json`).resolve("vite");
const vite: Vite = await import(pathToFileURL(vitePath).href);
process.chdir(client);

const built = await vite.build({
  root: client,
  configFile: `${client}vite.config.ts`,
  configLoader: "runner",
  logLevel: "silent",
  build: { write: false },
});

const chunks = (Array.isArray(built) ? built : [built])
  .flatMap((b) => [...b.output])
  .filter((c): c is Chunk => c.type === "chunk");
const entry = chunks.find((c) => c.isEntry && c.facadeModuleId?.endsWith("/index.html"));
if (!entry) {
  console.error("The build has no entry for index.html");
  process.exit(2);
}

/** The entry and every chunk it imports up front: what a first visit downloads before it runs. */
const first = new Map<string, Chunk>();
const visit = (chunk: Chunk | undefined) => {
  if (!chunk || first.has(chunk.fileName)) return;
  first.set(chunk.fileName, chunk);
  for (const name of chunk.imports) visit(chunks.find((c) => c.fileName === name));
};
visit(entry);

let gzipped = 0;
const sizes = new Map<string, number>();
for (const chunk of first.values()) {
  gzipped += gzipSync(chunk.code).length;
  for (const [id, mod] of Object.entries(chunk.modules)) {
    if (mod.renderedLength > 0) sizes.set(id, (sizes.get(id) ?? 0) + mod.renderedLength);
  }
}

/** A module as `client/feed-view.ts` or `npm:zod/v4/core/schemas.js`. */
function label(id: string): string {
  const ours = id.match(/\/packages\/([^/]+)\/(?:src\/)?(.+)$/);
  if (ours) return `${ours[1]}/${ours[2]}`;
  const dep = id.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/);
  if (dep) return `npm:${dep[1]}/${dep[2]}`;
  return id.replace(/^\0/, "");
}

/** The package a module belongs to: `client`, `npm:zod`. */
function packageOf(id: string): string {
  const name = label(id);
  const parts = name.split("/");
  if (!name.startsWith("npm:")) return parts[0] ?? name;
  return parts.slice(0, name.startsWith("npm:@") ? 2 : 1).join("/");
}

const kb = (bytes: number) => (bytes / 1000).toFixed(1).padStart(7);
const minified = [...sizes.values()].reduce((a, b) => a + b, 0);
const bySize = (a: [string, number], b: [string, number]) => b[1] - a[1];

console.log(
  `first load: ${(gzipped / 1000).toFixed(1)} kB gzipped in ${first.size} chunks, ${(minified / 1000).toFixed(0)} kB minified in ${sizes.size} modules`,
);

const packages = new Map<string, number>();
for (const [id, size] of sizes) {
  packages.set(packageOf(id), (packages.get(packageOf(id)) ?? 0) + size);
}
console.log("\nby package (minified kB, share):");
for (const [name, size] of [...packages].sort(bySize)) {
  console.log(`${kb(size)}  ${((100 * size) / minified).toFixed(0).padStart(3)}%  ${name}`);
}

if (top > 0) {
  console.log(`\ntop ${top} modules (minified kB):`);
  for (const [id, size] of [...sizes].sort(bySize).slice(0, top)) {
    console.log(`${kb(size)}  ${label(id)}`);
  }
}
