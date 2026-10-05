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
const HAND_BUILT: { pattern: RegExp; use: string }[] = [
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
  { pattern: /`\/[rp]\/\$\{/, use: "profilePath, postPath, or plot3dPath (paths.ts)" },
  { pattern: /class: "sheet[ "]|class: "sheet-(card|head|title|close)"/, use: "sheet (ui.ts)" },
];

describe("views use the shared components", () => {
  const files = sources();

  it("finds the app sources", () => {
    expect(files.some((f) => f.path === "client/src/post-card.ts")).toBe(true);
    expect(files.some((f) => f.path === "admin/src/queue-view.ts")).toBe(true);
  });

  for (const { pattern, use } of HAND_BUILT) {
    it(`nothing hand-builds what ${use} makes`, () => {
      const hits = files.flatMap((f) =>
        f.text
          .split("\n")
          .flatMap((line, i) => (pattern.test(line) ? [`${f.path}:${i + 1}: ${line.trim()}`] : [])),
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

/** Top-level selector lists and keyframes names in a stylesheet, in order, comments removed. */
function topLevelRules(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  let depth = 0;
  let head = "";
  for (const ch of text) {
    if (ch === "{") {
      if (depth === 0) {
        const name = head.trim().replace(/\s+/g, " ");
        // A media query wraps rules; keyframes are named once like a rule.
        if (!name.startsWith("@media") && !name.startsWith("@supports")) rules.push(name);
      }
      depth++;
      head = "";
    } else if (ch === "}") {
      depth--;
      head = "";
    } else if (ch === ";" && depth === 0) {
      head = "";
    } else if (depth === 0) {
      head += ch;
    }
  }
  return rules;
}

describe("one definition per rule", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  const base = new Set(topLevelRules(read("ui/src/base.css")));

  it("parses selector lists and keyframes", () => {
    expect(topLevelRules("/* x */ .a,\n.b { c: d; }\n@keyframes k { from { e: f; } }")).toEqual([
      ".a, .b",
      "@keyframes k",
    ]);
  });

  for (const path of ["ui/src/base.css", "client/src/style.css", "admin/src/style.css"]) {
    it(`${path} defines each selector once`, () => {
      const seen = new Set<string>();
      const twice = topLevelRules(read(path)).filter((r) => seen.has(r) || !seen.add(r));
      expect(twice).toEqual([]);
    });
  }

  for (const path of ["client/src/style.css", "admin/src/style.css"]) {
    it(`${path} leaves the shared components' rules to base.css`, () => {
      expect(topLevelRules(read(path)).filter((r) => base.has(r))).toEqual([]);
    });
  }
});
