/**
 * Both apps draw residents, times, cards, sheets, and form rows with the components in
 * `packages/ui/` (people.ts, ui.ts, when.ts) and style them from `packages/ui/src/base.css`. These
 * checks fail when a view builds one by hand again or an app stylesheet redefines a rule, which is
 * how two copies of the same thing start to drift apart.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isIconName } from "@terrakin/ui/icons";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const APP_DIRS = ["packages/client/src", "packages/admin/src"];

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        out.push({ path: relative(ROOT, full), text: readFileSync(full, "utf8") });
    }
  };
  for (const dir of APP_DIRS) walk(join(ROOT, dir));
  return out;
}

/** A tab row of buttons built by hand: a tablist, a tab, or a tab marked picked. */
const TAB_ROW = /role(: |=)"tab(list)?"|setAttribute\("aria-selected"/;

/** Hand-built versions of a shared component, and the component to use instead. */
/** `home` is the one file allowed to do it: the helper itself. */
const HAND_BUILT: { pattern: RegExp; use: string; home?: string }[] = [
  {
    pattern: /class: [`"]avatar\b/,
    use: "avatarEl, paintAvatar, or avatarPlaceholder (people.ts)",
  },
  { pattern: /\.map\(\(?\w+\)? => avatarEl\(/, use: "avatarStack (people.ts)" },
  {
    pattern: /aiBadge\(\)|townsfolk \? townsfolkBadge\(\)/,
    use: "badges or personLink (people.ts)",
  },
  { pattern: /class: [`"][^`"]*\btag-card\b/, use: "tagCard (people.ts)" },
  { pattern: /h\(\s*"time"/, use: "timeAgo (when.ts)" },
  { pattern: /\{ ?\.\.\.\w+, avatar: null \}/, use: "residentPerson (people.ts)" },
  { pattern: /class: "[^"]*\bstate-card\b/, use: "stateCard (ui.ts)" },
  { pattern: /class: "[^"]*\bempty-note\b/, use: "emptyNote (ui.ts)" },
  { pattern: /class: "check-row"/, use: "checkRow (ui.ts)" },
  { pattern: /class: "paper menu"/, use: "moreMenu (ui.ts)" },
  { pattern: /copyText\(/, use: "copyButton or copyBlock (ui.ts)" },
  {
    pattern: /[\w.]+ === 1 \? (?:"[\w ]+" : "[\w ]+"|"1 \w+"|one : many)/,
    use: "plural or pluralWord (format.ts), or coins (purse.ts) for money",
  },
  { pattern: /toLocaleString\("en-US"\)/, use: "formatCount (format.ts)" },
  {
    pattern: /Intl\.DateTimeFormat\("en-US"/,
    use: "shortDate, relativeTime, or fullDate (format.ts)",
  },
  { pattern: /for \(const \w+ of \w+\) \w+\.disabled = true/, use: "whileBusyAll (ui.ts)" },
  { pattern: /\bpurse-hint\b/, use: "the hint class (base.css)" },
  { pattern: /dataset\.confirm/, use: "confirmTwice (ui.ts)" },
  { pattern: /"0 0 24 24"/, use: "icon (dom.ts), with a Lucide glyph added to icons.ts" },
  {
    pattern: /"#(fffaf0|fbf3e4|ecdcc0|2b2620|5a5146|b4532f|8f3d20|5e7f45|a3361a)"/i,
    use: "BRAND_HEX (brand.ts)",
  },
  {
    pattern: /(\w+)\.hidden = !\1\.hidden/,
    use: "disclosure (ui.ts)",
    // The world's HUD buttons are pressed toggles, styled by aria-pressed.
    home: "packages/client/src/world.ts",
  },
  { pattern: /document\.addEventListener\("pointerdown"/, use: "dropdown or moreMenu (ui.ts)" },
  { pattern: /"[^"]*\bload-more\b/, use: "moreButton (ui.ts)" },
  {
    pattern: /"swatch-dot"|createElement\("button"\)/,
    use: "chips (ui.ts), colorChips or shapeChips (join-form.ts)",
    home: "packages/client/src/join-form.ts",
  },
  { pattern: /"\(prefers-reduced-motion/, use: "reducedMotion or REDUCED_MOTION (motion.ts)" },
  { pattern: /void \w+\.offsetWidth/, use: "replay (motion.ts)" },
  { pattern: /class: "[^"]*\b(form-error|error|composer-error)\b/, use: "errorLine (ui.ts)" },
  {
    pattern: /\.data\.error\.message/,
    use: "actProblem (packages/client/src/api.ts)",
    home: "packages/client/src/api.ts",
  },
  {
    pattern: /toast\(problem \?\? \w+\)|whileBusy\(\w+, \(\) => api\.act\(action\)\)/,
    use: "actFromButton (packages/client/src/act.ts)",
    home: "packages/client/src/act.ts",
  },
  { pattern: /`\/[rp]\/\$\{/, use: "profilePath, postPath, or plot3dPath (paths.ts)" },
  {
    pattern: /class: "sheet[ "]|class: "sheet-(card|head|title|close)"|role: "dialog"/,
    use: "sheet (ui.ts)",
  },
  { pattern: /class: [`"]sheet-close\b/, use: "closeButton (ui.ts)" },
  { pattern: /class: [`"][^`"]*\b(card-bar|devlog-head)\b/, use: "cardBar (ui.ts)" },
  { pattern: /"Share on X"|xIntentUrl\(/, use: "shareOnX (ui.ts)" },
  { pattern: /["'`]item-art\b|CROP_COLORS/, use: "itemArt or CROP_HEX (item-art.ts)" },
  { pattern: /GROUND_LOOK|["'`]ground-art\b/, use: "paintGround or groundArt (ground-art.ts)" },
  { pattern: /petShapes\(|["'`]pet-art\b/, use: "petArt or drawPet (pet-art.ts)" },
  {
    pattern: /mediaUrlOf\([\w.]+\.media\)|class: "[^"]*\bthing-picture\b/,
    use: "thingPicture (item-art.ts)",
  },
  { pattern: /class: "[^"]*-(row|line|good|order)-body\b/, use: "itemRow and itemRows (ui.ts)" },
  { pattern: /class: [`"][^`"]*\b(proposal-kind|kind-pill)\b/, use: "kindPill (ui.ts)" },
  { pattern: /role: "progressbar"/, use: "progressBar (ui.ts)" },
  { pattern: /class: [`"][^`"]*\blink-tabs?\b/, use: "linkTabs (ui.ts)" },
  {
    pattern: /["'`]palette-(choice|chip)\b/,
    use: "paintBlockRow, paintGroundRow, or paintHeldRow (build-palette.ts)",
    home: "packages/client/src/build-palette.ts",
  },
  { pattern: TAB_ROW, use: "linkTabs with pick, and pickTab (ui.ts)" },
  {
    pattern: /class: [`"]pulse paper card\b/,
    use: "pulseShell (pulse-cards.ts)",
    home: "packages/client/src/pulse-cards.ts",
  },
  {
    pattern: /history\.state as \{ overlay/,
    use: "the router, which closes an open overlay as it navigates (leaveOverlay in ui.ts)",
  },
];

describe("views use the shared components", () => {
  const files = sources();

  it("finds the app sources", () => {
    expect(files.some((f) => f.path === "packages/client/src/post-card.ts")).toBe(true);
    expect(files.some((f) => f.path === "packages/admin/src/queue-view.ts")).toBe(true);
  });

  for (const { pattern, use, home } of HAND_BUILT) {
    it(`nothing hand-builds what ${use} makes`, () => {
      const hits = files
        .filter((f) => f.path !== home)
        .flatMap((f) =>
          f.text
            .split("\n")
            .flatMap((line, i) =>
              pattern.test(line) ? [`${f.path}:${i + 1}: ${line.trim()}`] : [],
            ),
        );
      expect(hits).toEqual([]);
    });
  }

  it("the staff app never shows a resident's picture outside the tap-to-reveal", () => {
    const admin = files.filter((f) => f.path.startsWith("packages/admin/"));
    const calls = admin.flatMap((f) => [
      ...f.text.matchAll(/(avatarEl|paintAvatar|personLink)\(/g),
    ]);
    const unblurred = admin.flatMap((f) =>
      [
        ...f.text.matchAll(
          /(avatarEl|paintAvatar)\(|personLink\((?:(?!picture: false)[\s\S])*?\}\)/g,
        ),
      ].map((m) => `${f.path}: ${m[0].slice(0, 60)}`),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(unblurred).toEqual([]);
  });

  it("the apps' static pages build no tab row by hand either", () => {
    const hits = ["packages/client/index.html", "packages/admin/index.html"].flatMap((path) =>
      readFileSync(join(ROOT, path), "utf8")
        .split("\n")
        .flatMap((line, i) => (TAB_ROW.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("index.html names its icons from the Lucide map instead of drawing them", () => {
    const html = readFileSync(join(ROOT, "packages/client/index.html"), "utf8");
    const drawn = [...html.matchAll(/<svg class="icon[^"]*"(?! data-icon=)[^>]*>/g)].map(
      (m) => m[0],
    );
    const names = [...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(drawn).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !isIconName(name))).toEqual([]);
  });

  it("people helpers come from @terrakin/ui/people, not through another view", () => {
    const reexports = files.filter((f) =>
      /export \{[^}]*\} from "@terrakin\/ui\/people"/.test(f.text),
    );
    expect(reexports.map((f) => f.path)).toEqual([]);
  });
});

/**
 * The selector lists in a stylesheet, comments removed: `top` for top-level rules and keyframes
 * names, `nested` for rules inside a media or supports query.
 */
function cssRules(css: string): { top: string[]; nested: string[] } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const top: string[] = [];
  const nested: string[] = [];
  // For each open brace: whether it opened a media or supports query.
  const stack: boolean[] = [];
  let head = "";
  for (const ch of text) {
    if (ch === "{") {
      const name = head.trim().replace(/\s+/g, " ");
      const query = name.startsWith("@media") || name.startsWith("@supports");
      if (stack.length === 0 && !query) top.push(name);
      else if (stack.length > 0 && stack.every(Boolean) && !query) nested.push(name);
      stack.push(query);
      head = "";
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";") {
      head = "";
    } else {
      head += ch;
    }
  }
  return { top, nested };
}

/** A stylesheet with its @media, @supports and @keyframes blocks taken out. */
function topLevel(text: string): string {
  let out = "";
  let depth = 0;
  let inAt = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "@" && depth === 0) inAt = 1;
    // A statement like @import ends at its semicolon, not a block.
    if (ch === ";" && depth === 0) inAt = 0;
    if (ch === "{") depth++;
    if (!inAt) out += ch;
    if (ch === "}") {
      depth--;
      if (depth === 0 && inAt) {
        inAt = 0;
        out += "}";
      }
    }
  }
  return out;
}

/** Each selector of a list on its own: ".a, .b" is ".a" and ".b". */
const selectors = (lists: string[]) => lists.flatMap((l) => l.split(",").map((x) => x.trim()));

describe("one definition per rule", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  const base = new Set(selectors(cssRules(read("packages/ui/src/base.css")).top));

  it("parses selector lists, keyframes, and rules inside media queries", () => {
    const css =
      "/* x */ .a,\n.b { c: d; }\n@keyframes k { from { e: f; } }\n@media (x) { .c { g: h; } }";
    expect(cssRules(css)).toEqual({ top: [".a, .b", "@keyframes k"], nested: [".c"] });
  });

  for (const path of [
    "packages/ui/src/base.css",
    "packages/client/src/style.css",
    "packages/admin/src/style.css",
  ]) {
    it(`${path} defines each selector once`, () => {
      const seen = new Set<string>();
      const twice = cssRules(read(path)).top.filter((r) => seen.has(r) || !seen.add(r));
      expect(twice).toEqual([]);
    });
  }

  it("stylesheets name a token instead of spelling out its color", () => {
    const tokens = new Map(
      [...read("packages/ui/src/tokens.css").matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(
        (m) => [m[2]?.toLowerCase(), m[1]],
      ),
    );
    const spelled = [
      "packages/ui/src/base.css",
      "packages/client/src/style.css",
      "packages/admin/src/style.css",
    ].flatMap((path) =>
      [...read(path).matchAll(/#[0-9a-f]{6}\b/gi)].flatMap((m) => {
        const token = tokens.get(m[0].toLowerCase());
        return token ? [`${path}: ${m[0]} is var(${token})`] : [];
      }),
    );
    expect(tokens.size).toBeGreaterThan(10);
    expect(spelled).toEqual([]);
  });

  it("no one-sided accent strokes: a callout or card marks itself with color and a soft fill", () => {
    // A bar down one side (or under a banner) of 2px or more. Thin dividers between rows and the
    // dashed thread line beside replies are structure, not accents, and stay under 2px or dashed.
    const bars = [
      "packages/ui/src/base.css",
      "packages/client/src/style.css",
      "packages/admin/src/style.css",
    ].flatMap((path) =>
      [
        ...read(path).matchAll(
          /border-(?:left|right|top|bottom|inline-start|inline-end|block-start|block-end)\s*:\s*([2-9]|\d{2,})px\s+solid[^;]*;/g,
        ),
      ].map((m) => `${path}: ${m[0]}`),
    );
    expect(bars).toEqual([]);
  });

  it("spacing, type and corners come from the token scales", () => {
    // 4px and up in a gap, padding, margin, font-size or radius is a token. Under 4px is a
    // hairline or a nudge. A calc() is geometry tied to a fixed size, and a clamp() font-size is a
    // fluid headline; both say what they measure, so they're left alone.
    const scaled =
      /^\s*(gap|row-gap|column-gap|padding[\w-]*|margin[\w-]*|font-size|border[\w-]*radius)\s*:\s*(.+?);/;
    const off = [
      "packages/ui/src/base.css",
      "packages/client/src/style.css",
      "packages/admin/src/style.css",
      "packages/client/src/docs/docs.css",
    ].flatMap((path) =>
      read(path)
        .split("\n")
        .flatMap((line, i) => {
          const m = line.match(scaled);
          if (!m?.[2] || /calc\(|clamp\(/.test(m[2])) return [];
          const raw = [...m[2].matchAll(/(\d+(?:\.\d+)?)(px|rem)\b/g)].filter(
            ([, n, unit]) => unit === "rem" || Number(n) >= 4,
          );
          return raw.length ? [`${path}:${i + 1} ${m[1]}: ${m[2]}`] : [];
        }),
    );
    expect(off).toEqual([]);
  });

  it("line heights and weights come from their scales", () => {
    // A unitless line height or a numeric weight is a token. A px line height is a tap target.
    const off = [
      "packages/ui/src/base.css",
      "packages/client/src/style.css",
      "packages/admin/src/style.css",
      "packages/client/src/docs/docs.css",
    ].flatMap((path) =>
      read(path)
        .split("\n")
        .flatMap((line, i) =>
          /^\s*(line-height:\s*\d*\.?\d+;|font-weight:\s*\d+)/.test(line)
            ? [`${path}:${i + 1} ${line.trim()}`]
            : [],
        ),
    );
    expect(off).toEqual([]);
  });

  it("app stylesheets use the layout primitives instead of restating them", () => {
    // A rule made only of what .stack, .cluster and .plain-list already say is a copy of them:
    // put the primitive in the view's class list instead (base.css lists them).
    const primitive = new Set([
      "display: grid",
      "gap: var(--space-md)",
      "gap: var(--space-sm)",
      "gap: var(--gap-page)",
      "align-content: start",
      "min-width: 0",
      "justify-items: start",
      "margin: 0",
      "padding: 0",
      "list-style: none",
    ]);
    const cluster = "display: flex; flex-wrap: wrap; gap: var(--space-sm)";
    // The lookbehind leaves each rule's closing brace for the next match, so no rule is skipped.
    const copies = ["packages/client/src/style.css", "packages/admin/src/style.css"].flatMap(
      (path) =>
        [
          ...topLevel(read(path).replace(/\/\*[\s\S]*?\*\//g, "")).matchAll(
            /(?<=^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g,
          ),
        ].flatMap(([, selector, body]) => {
          const decls = (body ?? "")
            .split(";")
            .map((d) => d.trim().replace(/\s+/g, " "))
            .filter(Boolean);
          const list = ["margin: 0", "padding: 0", "list-style: none"];
          const restates =
            decls.length > 0 &&
            ((decls.includes("display: grid") && decls.every((d) => primitive.has(d))) ||
              [...decls].sort().join("; ") === cluster ||
              (decls.length === 3 && list.every((d) => decls.includes(d))));
          return restates ? [`${path}: ${selector?.trim()} { ${decls.join("; ")} }`] : [];
        }),
    );
    expect(copies).toEqual([]);
  });

  it("app stylesheets lay pages out with .column or .layout, never a width or sidebar of their own", () => {
    // A page is a .column (one column) or a .layout (main and sidebar), both in base.css, so
    // every page lines up with the site bar and the footer.
    const own = ["packages/client/src/style.css", "packages/admin/src/style.css"].flatMap((path) =>
      [
        ...read(path).matchAll(
          /max-width: (?:1240|1120)px|grid-template-columns: minmax\(0, 1fr\) \d+px/g,
        ),
      ].map((m) => `${path}: ${m[0]}`),
    );
    expect(own).toEqual([]);
  });

  it("the scales the stylesheets use are all defined", () => {
    const defined = new Set(
      [...read("packages/ui/src/tokens.css").matchAll(/(--[\w-]+):/g)].map((m) => m[1]),
    );
    const used = [
      "packages/ui/src/base.css",
      "packages/client/src/style.css",
      "packages/admin/src/style.css",
    ].flatMap((path) =>
      [...read(path).matchAll(/var\((--(?:space|text|r|gap|leading|weight)-[\w-]+)\)/g)].map(
        (m) => m[1],
      ),
    );
    expect(used.length).toBeGreaterThan(500);
    expect([...new Set(used)].filter((t) => !defined.has(t))).toEqual([]);
  });

  for (const path of ["packages/client/src/style.css", "packages/admin/src/style.css"]) {
    it(`${path} leaves the shared components' rules to base.css, at every screen size`, () => {
      const { top, nested } = cssRules(read(path));
      expect(selectors([...top, ...nested]).filter((r) => base.has(r))).toEqual([]);
    });
  }
});
