/**
 * Regenerates everything derived from the route table (protocol/src/routes.ts).
 *
 *   pnpm gen          rewrite the generated files
 *   pnpm gen:check    fail if any generated file is stale (verify and CI run this)
 *
 * Writes the API block in protocol/SKILL.md and client/public/llms.txt (between the
 * `generated:api` markers), the protocol/openapi.json snapshot, and the guides on the docs page
 * (client/src/docs/guides.generated.md, from docs/guides, SKILL.md, and the OpenAPI document).
 *
 * Plain Node (type stripping), no dependencies beyond the workspace packages it renders.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The workspace packages import each other without file extensions, which bundlers and tsx
// accept and Node does not. Retry an extensionless relative import as a .ts file.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});

const { buildOpenApi } = await import("../protocol/src/openapi.ts");
const { llmsApiBlock, replaceGenerated, skillApiBlock } = await import("../protocol/src/docs.ts");
const { docsGuides } = await import("../protocol/src/guides.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const TARGETS: { file: string; render: (current: string) => string }[] = [
  {
    file: "protocol/SKILL.md",
    render: (current) => replaceGenerated(current, skillApiBlock(), "protocol/SKILL.md"),
  },
  {
    file: "client/public/llms.txt",
    render: (current) => replaceGenerated(current, llmsApiBlock(), "client/public/llms.txt"),
  },
  {
    file: "protocol/openapi.json",
    render: () => `${JSON.stringify(buildOpenApi(), null, 2)}\n`,
  },
  {
    // After SKILL.md, so the guides render its freshly generated text.
    file: "client/src/docs/guides.generated.md",
    render: () =>
      docsGuides({
        gettingStarted: read("docs/guides/getting-started.md"),
        skill: rendered.get("protocol/SKILL.md") ?? read("protocol/SKILL.md"),
        openapi: buildOpenApi(),
      }),
  },
];

const check = process.argv.includes("--check");
const stale: string[] = [];
/** What each target renders to in this run, so a later target can build on an earlier one. */
const rendered = new Map<string, string>();
for (const { file, render } of TARGETS) {
  const path = join(ROOT, file);
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // A missing snapshot is just stale.
  }
  const next = render(current);
  rendered.set(file, next);
  if (next === current) continue;
  stale.push(file);
  if (!check) writeFileSync(path, next);
}

if (check && stale.length > 0) {
  console.error(
    `Generated files are out of date with protocol/src/routes.ts:\n${stale.map((f) => `  ${f}`).join("\n")}\nRun \`pnpm gen\` and commit the result.`,
  );
  process.exit(1);
}
console.log(
  stale.length === 0 ? "Generated files are up to date." : `Regenerated ${stale.join(", ")}.`,
);
