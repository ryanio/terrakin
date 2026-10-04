/**
 * Regenerates everything derived from the route table (protocol/src/routes.ts) and the site
 * config (protocol/src/site.ts).
 *
 *   pnpm gen          rewrite the generated files
 *   pnpm gen:check    fail if any generated file is stale (verify and CI run this)
 *
 * Writes the generated blocks in protocol/SKILL.md, client/public/llms.txt, and docs/site/*.md,
 * the protocol/openapi.json snapshot, the discovery files under client/public (sitemap-pages.xml,
 * robots.txt, docs.md, docs/llms.txt, .well-known/*), docs/site/lastmod.json, and the guides on
 * the docs page (client/src/docs/guides.generated.md, from docs/guides, SKILL.md, and OpenAPI).
 *
 * Dates are deterministic: lastmod.json stores a hash of each page's sources, and a page's date
 * moves to today only when that hash changes. Check mode compares hashes, never dates.
 *
 * Plain Node (type stripping), no dependencies beyond the workspace packages it renders.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const docs = await import("../protocol/src/docs.ts");
const discovery = await import("../protocol/src/discovery.ts");
const { docsGuides } = await import("../protocol/src/guides.ts");
const { PAGES } = await import("../protocol/src/site.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LASTMOD = "docs/site/lastmod.json";
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** Today, or TERRAKIN_GEN_DATE (YYYY-MM-DD) for reproducible runs. */
const today = process.env.TERRAKIN_GEN_DATE ?? new Date().toISOString().slice(0, 10);

/** What each file will hold after this run, so later targets see earlier ones' new content. */
const next = new Map<string, string>();
const current = new Map<string, string>();
function read(file: string): string {
  if (next.has(file)) return next.get(file) as string;
  if (!current.has(file)) {
    let text = "";
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      // A missing file is just stale.
    }
    current.set(file, text);
  }
  return current.get(file) as string;
}

type LastmodFile = Record<string, { sha256: string; lastmod: string }>;
const lastmods = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(JSON.parse(read(LASTMOD)) as LastmodFile).map(([path, v]) => [path, v.lastmod]),
  );

/** In order: a target may read any target above it. */
const TARGETS: { file: string; render: (current: string) => string }[] = [
  {
    file: "protocol/SKILL.md",
    render: (text) => docs.replaceGenerated(text, docs.skillApiBlock(), "protocol/SKILL.md"),
  },
  {
    file: "client/public/llms.txt",
    render: (text) =>
      docs.replaceGenerated(
        docs.replaceGenerated(text, docs.llmsApiBlock(), "llms.txt"),
        docs.usesBlock(),
        "llms.txt",
        "uses",
      ),
  },
  { file: "protocol/openapi.json", render: () => json(buildOpenApi()) },
  {
    file: "docs/site/index.md",
    render: (text) =>
      docs.replaceGenerated(
        docs.replaceGenerated(text, docs.usesBlock(), "index.md", "uses"),
        docs.faqBlock(),
        "index.md",
        "faq",
      ),
  },
  {
    file: "docs/site/pricing.md",
    render: (text) => docs.replaceGenerated(text, docs.limitsBlock(), "pricing.md", "limits"),
  },
  {
    // After SKILL.md, so the guides render its freshly generated text.
    file: "client/src/docs/guides.generated.md",
    render: () =>
      docsGuides({
        gettingStarted: read("docs/guides/getting-started.md"),
        skill: read("protocol/SKILL.md"),
        openapi: buildOpenApi(),
      }),
  },
  { file: "client/public/docs/llms.txt", render: () => docs.apiLlmsTxt() },
  {
    file: LASTMOD,
    render: (text) => {
      const old = (text ? JSON.parse(text) : {}) as LastmodFile;
      const fresh: LastmodFile = {};
      for (const page of PAGES) {
        const hash = sha256(page.sources.map((source) => read(source)).join("\0"));
        const prior = old[page.path];
        fresh[page.path] = {
          sha256: hash,
          lastmod: prior?.sha256 === hash ? prior.lastmod : today,
        };
      }
      return json(fresh);
    },
  },
  { file: "client/public/docs.md", render: () => docs.docsMarkdown(lastmods()["/docs"] ?? today) },
  { file: "client/public/sitemap-pages.xml", render: () => discovery.pagesSitemapXml(lastmods()) },
  { file: "client/public/robots.txt", render: () => discovery.robotsTxt() },
  {
    file: "client/public/.well-known/api-catalog",
    render: () => json(discovery.apiCatalog()),
  },
  {
    file: "client/public/.well-known/agent-skills/index.json",
    render: () => {
      const skill = read("protocol/SKILL.md");
      return json(discovery.agentSkillsIndex(skill, sha256(skill)));
    },
  },
  { file: "client/public/.well-known/ard.json", render: () => json(discovery.ardJson(lastmods())) },
];

const check = process.argv.includes("--check");
const stale: string[] = [];
for (const { file, render } of TARGETS) {
  const before = read(file);
  const after = render(before);
  next.set(file, after);
  if (after === before) continue;
  stale.push(file);
  if (!check) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true });
    writeFileSync(join(ROOT, file), after);
  }
}

if (check && stale.length > 0) {
  console.error(
    `Generated files are out of date with protocol/src/routes.ts or protocol/src/site.ts:\n${stale.map((f) => `  ${f}`).join("\n")}\nRun \`pnpm gen\` and commit the result.`,
  );
  process.exit(1);
}
console.log(
  stale.length === 0 ? "Generated files are up to date." : `Regenerated ${stale.join(", ")}.`,
);
