/**
 * Both apps draw residents, times, cards, sheets, and form rows with the components in `ui/`
 * (people.ts, ui.ts, when.ts) and style them from `ui/src/base.css`. These checks fail when a view
 * builds one by hand again or an app stylesheet redefines a rule, which is how two copies of the
 * same thing start to drift apart.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const APP_DIRS = ["client/src", "admin/src"];

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

/** Hand-built versions of a shared component, and the component to use instead. */
/** `home` is the one file allowed to do it: the helper itself. */
const HAND_BUILT: { pattern: RegExp; use: string; home?: string }[] = [
  {
    pattern: /class: [`"]avatar\b/,
    use: "avatarEl, paintAvatar, or avatarPlaceholder (people.ts)",
  },
  {
    pattern: /aiBadge\(\)|townsfolk \? townsfolkBadge\(\)/,
    use: "badges or personLink (people.ts)",
  },
  { pattern: /h\(\s*"time"/, use: "timeAgo (when.ts)" },
  { pattern: /\{ ?\.\.\.\w+, avatar: null \}/, use: "residentPerson (people.ts)" },
  { pattern: /class: "[^"]*\bstate-card\b/, use: "stateCard (ui.ts)" },
  { pattern: /class: "[^"]*\bempty-note\b/, use: "emptyNote (ui.ts)" },
  { pattern: /class: "check-row"/, use: "checkRow (ui.ts)" },
  { pattern: /class: "paper menu"/, use: "moreMenu (ui.ts)" },
  { pattern: /copyText\(/, use: "copyButton or copyBlock (ui.ts)" },
  {
    pattern: /\} \$\{\w+ === 1 \? "\w+" : "\w+"\}|=== 1 \? "1 \w+"/,
    use: "plural (format.ts), or coins (purse.ts) for money",
    home: "client/src/purse.ts",
  },
  { pattern: /dataset\.confirm/, use: "confirmTwice (ui.ts)" },
  { pattern: /"[^"]*\bload-more\b/, use: "moreButton (ui.ts)" },
  {
    pattern: /"swatch-dot"|createElement\("button"\)/,
    use: "chips (ui.ts), colorChips or shapeChips (join-form.ts)",
    home: "client/src/join-form.ts",
  },
  { pattern: /"\(prefers-reduced-motion/, use: "reducedMotion or REDUCED_MOTION (motion.ts)" },
  { pattern: /void \w+\.offsetWidth/, use: "replay (motion.ts)" },
  { pattern: /class: "[^"]*\b(form-error|error|composer-error)\b/, use: "errorLine (ui.ts)" },
  {
    pattern: /\.data\.error\.message/,
    use: "actProblem (client/src/api.ts)",
    home: "client/src/api.ts",
  },
  { pattern: /`\/[rp]\/\$\{/, use: "profilePath, postPath, or plot3dPath (paths.ts)" },
  { pattern: /class: "sheet[ "]|class: "sheet-(card|head|title|close)"/, use: "sheet (ui.ts)" },
];

describe("views use the shared components", () => {
  const files = sources();

  it("finds the app sources", () => {
    expect(files.some((f) => f.path === "client/src/post-card.ts")).toBe(true);
    expect(files.some((f) => f.path === "admin/src/queue-view.ts")).toBe(true);
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
    const admin = files.filter((f) => f.path.startsWith("admin/"));
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

/** Each selector of a list on its own: ".a, .b" is ".a" and ".b". */
const selectors = (lists: string[]) => lists.flatMap((l) => l.split(",").map((x) => x.trim()));

describe("one definition per rule", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  const base = new Set(selectors(cssRules(read("ui/src/base.css")).top));

  it("parses selector lists, keyframes, and rules inside media queries", () => {
    const css =
      "/* x */ .a,\n.b { c: d; }\n@keyframes k { from { e: f; } }\n@media (x) { .c { g: h; } }";
    expect(cssRules(css)).toEqual({ top: [".a, .b", "@keyframes k"], nested: [".c"] });
  });

  for (const path of ["ui/src/base.css", "client/src/style.css", "admin/src/style.css"]) {
    it(`${path} defines each selector once`, () => {
      const seen = new Set<string>();
      const twice = cssRules(read(path)).top.filter((r) => seen.has(r) || !seen.add(r));
      expect(twice).toEqual([]);
    });
  }

  it("stylesheets name a token instead of spelling out its color", () => {
    const tokens = new Map(
      [...read("ui/src/tokens.css").matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
        m[2]?.toLowerCase(),
        m[1],
      ]),
    );
    const spelled = ["ui/src/base.css", "client/src/style.css", "admin/src/style.css"].flatMap(
      (path) =>
        [...read(path).matchAll(/#[0-9a-f]{6}\b/gi)].flatMap((m) => {
          const token = tokens.get(m[0].toLowerCase());
          return token ? [`${path}: ${m[0]} is var(${token})`] : [];
        }),
    );
    expect(tokens.size).toBeGreaterThan(10);
    expect(spelled).toEqual([]);
  });

  for (const path of ["client/src/style.css", "admin/src/style.css"]) {
    it(`${path} leaves the shared components' rules to base.css, at every screen size`, () => {
      const { top, nested } = cssRules(read(path));
      expect(selectors([...top, ...nested]).filter((r) => base.has(r))).toEqual([]);
    });
  }
});
