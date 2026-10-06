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
 * The changelog (decision 0036): CHANGELOG.md becomes docs/site/changelog.md (the /changelog page
 * and its twin), client/public/changelog.xml (Atom), and protocol/src/changelog.generated.ts (the
 * data behind GET /v1/changelog). Its newest day carries the API fingerprint, a hash of
 * openapi.json and SKILL.md's API block. When the API changes, gen restamps it only if that day
 * has gained an entry since the last stamp, and gen:check fails until it has.
 *
 * The devlog (decision 0105): the posts in docs/devlog become docs/site/devlog.md (the /devlog
 * page and its twin), client/public/devlog.xml (Atom), and protocol/src/devlog.generated.ts (the
 * data behind GET /v1/devlog, the check-in's `devlog`, and each post's page in the client build).
 *
 * Plain Node (type stripping), no dependencies beyond the workspace packages it renders.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const changelog = await import("../protocol/src/changelog.ts");
const devlog = await import("../protocol/src/devlog.ts");

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

/** Messages that fail the run, like an API change with no changelog entry. */
const errors: string[] = [];
const check = process.argv.includes("--check");

/**
 * The API fingerprint: 12 hex characters of SHA-256 over the OpenAPI snapshot and SKILL.md's
 * generated API block, as this run will write them.
 */
const apiFingerprint = () =>
  sha256(`${read("protocol/openapi.json")}\0${docs.skillApiBlock()}`).slice(0, 12);

/** CHANGELOG.md, parsed. Throws a ChangelogError naming the bad line. */
const changelogLog = () => changelog.parseChangelog(read("CHANGELOG.md"));

const DEVLOG_DIR = "docs/devlog";
/** Every devlog post, newest first. Throws a DevlogError naming the file and the fix. */
const devlogPosts = () =>
  devlog.parseDevlog(
    readdirSync(join(ROOT, DEVLOG_DIR)).map((name) => {
      const file = `${DEVLOG_DIR}/${name}`;
      return { file, text: read(file) };
    }),
  );

type LastmodFile = Record<string, { sha256: string; lastmod: string }>;
const lastmods = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(JSON.parse(read(LASTMOD)) as LastmodFile).map(([path, v]) => [path, v.lastmod]),
  );

/** Replace each named generated block in `text`. */
const withBlocks = (text: string, file: string, blocks: Record<string, string>) =>
  Object.entries(blocks).reduce(
    (out, [name, block]) => docs.replaceGenerated(out, block, file, name),
    text,
  );

/** In order: a target may read any target above it. */
const TARGETS: { file: string; render: (current: string) => string }[] = [
  {
    file: "protocol/SKILL.md",
    render: (text) =>
      withBlocks(text, "protocol/SKILL.md", {
        api: docs.skillApiBlock(),
        catalog: docs.catalogBlock(),
        furniture: docs.furnitureBlock(),
      }),
  },
  {
    file: "client/public/llms.txt",
    render: (text) =>
      withBlocks(text, "llms.txt", {
        api: docs.llmsApiBlock(),
        uses: docs.usesBlock(),
        trust: docs.trustBlock(),
      }),
  },
  { file: "protocol/openapi.json", render: () => json(buildOpenApi()) },
  {
    // After openapi.json and SKILL.md, so the fingerprint covers what this run writes.
    file: "CHANGELOG.md",
    render: (text) => {
      const hash = apiFingerprint();
      if (check && changelog.apiChangedSinceStamp(text, hash)) {
        errors.push(changelog.API_CHANGED_MESSAGE);
        return text;
      }
      return changelog.stampFingerprint(text, hash);
    },
  },
  { file: "docs/site/changelog.md", render: () => changelog.changelogPage(changelogLog()) },
  {
    file: "protocol/src/changelog.generated.ts",
    render: () => changelog.changelogModule(changelogLog()),
  },
  { file: "client/public/changelog.xml", render: () => changelog.changelogAtom(changelogLog()) },
  { file: "docs/site/devlog.md", render: () => devlog.devlogPage(devlogPosts()) },
  {
    file: "protocol/src/devlog.generated.ts",
    render: () => devlog.devlogModule(devlogPosts()),
  },
  { file: "client/public/devlog.xml", render: () => devlog.devlogAtom(devlogPosts()) },
  {
    file: "docs/site/index.md",
    render: (text) =>
      withBlocks(text, "index.md", {
        uses: docs.usesBlock(),
        trust: docs.trustBlock(),
        faq: docs.faqBlock(),
      }),
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
        changelog: changelogLog(),
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
  {
    file: "client/public/sitemap-pages.xml",
    // Each devlog post is a page of its own, dated by its day: posts never change.
    render: () =>
      discovery.pagesSitemapXml(
        lastmods(),
        devlogPosts().map((p) => ({ loc: p.url, lastmod: p.date })),
      ),
  },
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

const stale: string[] = [];
for (const { file, render } of TARGETS) {
  const before = read(file);
  let after = before;
  try {
    after = render(before);
  } catch (err) {
    if (!(err instanceof changelog.ChangelogError || err instanceof devlog.DevlogError)) throw err;
    errors.push(err.message);
  }
  next.set(file, after);
  if (after === before) continue;
  stale.push(file);
  if (!check) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true });
    writeFileSync(join(ROOT, file), after);
  }
}

if (errors.length > 0) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
if (check && stale.length > 0) {
  console.error(
    `Generated files are out of date with protocol/src/routes.ts, protocol/src/site.ts, CHANGELOG.md, or docs/devlog:\n${stale.map((f) => `  ${f}`).join("\n")}\nRun \`pnpm gen\` and commit the result.`,
  );
  process.exit(1);
}
console.log(
  stale.length === 0 ? "Generated files are up to date." : `Regenerated ${stale.join(", ")}.`,
);
