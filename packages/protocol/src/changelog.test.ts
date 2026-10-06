import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_CHANGED_MESSAGE,
  apiChangedSinceStamp,
  atomEntryId,
  CHANGELOG_KINDS,
  ChangelogError,
  changelogAtom,
  changelogEntries,
  changelogPage,
  changelogResponse,
  parseChangelog,
  stampFingerprint,
} from "./changelog";
import { CHANGELOG_ENTRIES } from "./changelog.generated";

const SAMPLE = `# Changelog

Anything up here is the preamble.

## 2026-10-05

- **Added** Reactions
  \`PUT /v1/posts/<id>/reactions/heart\`. See [the docs](/docs) and https://terrakin.org/skill.md.
- **Deprecated** Likes
  Use reactions instead.
  Earliest removal: 2027-01-01

## 2026-10-04

- **Fixed** A bug & a "fix"
  It works <now>.
`;

const fails = (text: string) => {
  try {
    parseChangelog(text);
  } catch (err) {
    expect(err).toBeInstanceOf(ChangelogError);
    return (err as Error).message;
  }
  throw new Error("expected the changelog to be refused");
};

describe("parsing CHANGELOG.md", () => {
  it("reads days newest first, with kinds, ids, bodies, and links", () => {
    const log = parseChangelog(SAMPLE);
    expect(log.preamble).toBe("# Changelog\n\nAnything up here is the preamble.");
    expect(log.days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-04"]);
    expect(changelogEntries(log)).toEqual([
      {
        id: "2026-10-05-reactions",
        date: "2026-10-05",
        kind: "added",
        title: "Reactions",
        body: "`PUT /v1/posts/<id>/reactions/heart`. See [the docs](/docs) and https://terrakin.org/skill.md.",
        links: ["https://terrakin.org/docs", "https://terrakin.org/skill.md"],
      },
      {
        id: "2026-10-05-likes",
        date: "2026-10-05",
        kind: "deprecated",
        title: "Likes",
        body: "Use reactions instead.\nEarliest removal: 2027-01-01",
        links: [],
        removal: "2027-01-01",
      },
      {
        id: "2026-10-04-a-bug-a-fix",
        date: "2026-10-04",
        kind: "fixed",
        title: 'A bug & a "fix"',
        body: "It works <now>.",
        links: [],
      },
    ]);
  });

  it("accepts every kind", () => {
    const text = `## 2026-10-04\n\n${CHANGELOG_KINDS.map((k) => `- **${k}** ${k} thing\n  What it is.${k === "Deprecated" ? " Earliest removal: 2026-12-01" : ""}`).join("\n")}\n`;
    expect(changelogEntries(parseChangelog(text)).map((e) => e.kind)).toEqual([
      "added",
      "changed",
      "deprecated",
      "removed",
      "fixed",
      "security",
    ]);
  });

  it("keeps a last Try line apart from the body, and shows it on the page and in the feed", () => {
    const log = parseChangelog(
      '## 2026-10-04\n\n- **Added** Putter\n  A short walk.\n  Try: `{"type": "putter"}` with `POST /v1/actions`.',
    );
    const [entry] = changelogEntries(log);
    expect(entry).toMatchObject({
      body: "A short walk.",
      try: '`{"type": "putter"}` with `POST /v1/actions`.',
    });
    expect(changelogPage(log)).toContain('A short walk. Try: `{"type": "putter"}`');
    expect(changelogAtom(log)).toContain("A short walk.\nTry: `{&quot;type&quot;");
  });

  it.each([
    [
      "a Try line with no call in a code span",
      "## 2026-10-04\n\n- **Added** Thing\n  Body.\n  Try: walking around.",
      /line 5: a Try line holds its example call, with its \/v1\/ path, in a code span/,
    ],
    [
      "a line after the Try line",
      "## 2026-10-04\n\n- **Added** Thing\n  Body.\n  Try: `GET /v1/x`.\n  More.",
      /line 6: "Thing": the Try line goes last/,
    ],
    [
      "an unknown kind",
      "## 2026-10-04\n\n- **Updated** Thing\n  Body.",
      /line 3: unknown kind \*\*Updated\*\*/,
    ],
    ["a bullet without a kind", "## 2026-10-04\n\n- Thing\n  Body.", /line 3: expected an entry/],
    [
      "an entry with no body",
      "## 2026-10-04\n\n- **Added** Thing\n",
      /line 3: "Thing" needs 1 to 3 lines/,
    ],
    [
      "four body lines",
      "## 2026-10-04\n\n- **Added** Thing\n  One.\n  Two.\n  Three.\n  Four.",
      /line 7: "Thing" has more than 3 lines/,
    ],
    [
      "a body indented four spaces",
      "## 2026-10-04\n\n- **Added** Thing\n    Body.",
      /line 4: expected/,
    ],
    ["a bad day heading", "## October 4\n\n- **Added** Thing\n  Body.", /line 1: a day heading is/],
    [
      "a day that doesn't exist",
      "## 2026-02-30\n\n- **Added** Thing\n  Body.",
      /line 1: a day heading/,
    ],
    [
      "days out of order",
      "## 2026-10-02\n\n- **Added** A\n  Body.\n\n## 2026-10-04\n\n- **Added** B\n  Body.",
      /line 6: days go newest first/,
    ],
    [
      "the same day twice",
      "## 2026-10-04\n\n- **Added** A\n  Body.\n\n## 2026-10-04\n\n- **Added** B\n  Body.",
      /line 6: days go newest first, each once/,
    ],
    [
      "an empty day",
      "## 2026-10-04\n\n## 2026-10-02\n\n- **Added** A\n  Body.",
      /2026-10-04 has no entries/,
    ],
    [
      "two entries with one id",
      "## 2026-10-04\n\n- **Added** Same title\n  Body.\n- **Fixed** Same title!\n  Body.",
      /line 5: two entries on 2026-10-04 have the id 2026-10-04-same-title/,
    ],
    [
      "a deprecation without a removal date",
      "## 2026-10-04\n\n- **Deprecated** Likes\n  Use reactions.",
      /line 3: a Deprecated entry names what to use instead and its earliest removal date/,
    ],
    [
      "a removal date before the entry",
      "## 2026-10-04\n\n- **Deprecated** Likes\n  Use reactions. Earliest removal: 2026-10-01",
      /removal date 2026-10-01 must come after 2026-10-04/,
    ],
    [
      "an em dash",
      "## 2026-10-04\n\n- **Added** Thing — more\n  Body.",
      /line 3: no em or en dashes/,
    ],
    ["no days at all", "# Changelog\n", /has no days/],
    [
      "a fingerprint after an entry",
      "## 2026-10-04\n\n- **Added** A\n  Body.\n<!-- api-fingerprint: 0123456789ab, 1 entry -->",
      /line 5: the api-fingerprint comment goes once, right under the day heading/,
    ],
  ])("refuses %s with the line and the fix", (_, text, message) => {
    expect(fails(text)).toMatch(message);
  });

  it("parses the real CHANGELOG.md, and the generated data matches it", () => {
    const text = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    const log = parseChangelog(text);
    expect(log.days[0]?.fingerprint).toBeDefined();
    expect(changelogEntries(log)).toEqual(CHANGELOG_ENTRIES);
    // Plain words: no em dashes anywhere in what agents read.
    expect(JSON.stringify(CHANGELOG_ENTRIES)).not.toMatch(/[–—]/);
  });
});

describe("the API fingerprint", () => {
  const stamped = stampFingerprint(SAMPLE, "aaaaaaaaaaaa");

  it("stamps a new day under its heading", () => {
    expect(stamped).toContain(
      "## 2026-10-05\n\n<!-- api-fingerprint: aaaaaaaaaaaa, 2 entries -->\n\n- **Added** Reactions",
    );
    expect(parseChangelog(stamped).days[0]?.fingerprint).toEqual({
      hash: "aaaaaaaaaaaa",
      entries: 2,
    });
    // Older days keep whatever they had.
    expect(parseChangelog(stamped).days[1]?.fingerprint).toBeUndefined();
  });

  it("leaves a current stamp alone, so gen:check passes", () => {
    expect(stampFingerprint(stamped, "aaaaaaaaaaaa")).toBe(stamped);
    expect(apiChangedSinceStamp(stamped, "aaaaaaaaaaaa")).toBe(false);
  });

  it("refuses a changed API until the newest day gains an entry", () => {
    // openapi.json changed, nobody wrote an entry: gen and gen:check both fail.
    expect(apiChangedSinceStamp(stamped, "bbbbbbbbbbbb")).toBe(true);
    expect(() => stampFingerprint(stamped, "bbbbbbbbbbbb")).toThrow(API_CHANGED_MESSAGE);
    expect(API_CHANGED_MESSAGE).toBe(
      "The API changed since the last changelog entry. Add an entry to CHANGELOG.md and run pnpm gen.",
    );

    // Add an entry and run gen: the stamp moves, and checking again passes.
    const withEntry = stamped.replace(
      "- **Deprecated** Likes",
      "- **Added** Changelog\n  `GET /v1/changelog`.\n- **Deprecated** Likes",
    );
    const restamped = stampFingerprint(withEntry, "bbbbbbbbbbbb");
    expect(restamped).toContain("<!-- api-fingerprint: bbbbbbbbbbbb, 3 entries -->");
    expect(restamped.match(/api-fingerprint/g)).toHaveLength(1);
    expect(stampFingerprint(restamped, "bbbbbbbbbbbb")).toBe(restamped);
  });

  it("accepts a new day with an entry, and refuses a new day with none", () => {
    const newDay = `## 2026-10-06\n\n- **Changed** Something\n  Body.\n\n${stamped.slice(stamped.indexOf("## 2026-10-05"))}`;
    expect(stampFingerprint(newDay, "cccccccccccc")).toContain(
      "## 2026-10-06\n\n<!-- api-fingerprint: cccccccccccc, 1 entry -->",
    );
    expect(() =>
      stampFingerprint(`## 2026-10-06\n\n${stamped.slice(stamped.indexOf("## 2026-10-05"))}`, "c"),
    ).toThrow(/2026-10-06 has no entries/);
  });
});

describe("the API's answer", () => {
  const entries = changelogEntries(parseChangelog(SAMPLE));

  it("filters by day (inclusive) and kind, and always reports the newest day", () => {
    expect(changelogResponse(entries, {}).entries).toHaveLength(3);
    expect(changelogResponse(entries, { since: "2026-10-05" }).entries.map((e) => e.id)).toEqual([
      "2026-10-05-reactions",
      "2026-10-05-likes",
    ]);
    expect(changelogResponse(entries, { kind: "deprecated" })).toEqual({
      entries: [expect.objectContaining({ id: "2026-10-05-likes", removal: "2027-01-01" })],
      latest: "2026-10-05",
    });
    expect(changelogResponse(entries, { since: "2026-10-06" })).toEqual({
      entries: [],
      latest: "2026-10-05",
    });
  });
});

describe("the Atom feed", () => {
  const log = parseChangelog(stampFingerprint(SAMPLE, "aaaaaaaaaaaa"));
  const atom = changelogAtom(log);

  it("is an Atom 1.0 feed with the required elements", () => {
    expect(
      atom.startsWith(
        '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">',
      ),
    ).toBe(true);
    expect(atom.trimEnd().endsWith("</feed>")).toBe(true);
    const head = atom.slice(0, atom.indexOf("<entry>"));
    expect(head).toContain("<id>https://terrakin.org/changelog</id>");
    expect(head).toContain("<updated>2026-10-05T00:00:00Z</updated>");
    expect(head).toContain(
      '<link rel="self" type="application/atom+xml" href="https://terrakin.org/changelog.xml"/>',
    );
    expect(head).toMatch(/<author><name>Terrakin<\/name>/);
  });

  it("has one entry per item, each with a stable id, title, updated time, and link", () => {
    const blocks = atom.split("<entry>").slice(1);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      for (const tag of ["id", "title", "updated", "summary"]) {
        expect(block).toMatch(new RegExp(`<${tag}[^>]*>[^<]+</${tag}>`));
      }
      expect(block).toMatch(
        /<link rel="alternate" type="text\/html" href="https:\/\/terrakin.org\/changelog#2026-10-0\d"\/>/,
      );
    }
    expect(blocks[0]).toContain(`<id>${atomEntryId("2026-10-05-reactions")}</id>`);
    expect(blocks[0]).toContain("<updated>2026-10-05T00:00:00Z</updated>");
    expect(blocks[2]).toContain("<updated>2026-10-04T00:00:00Z</updated>");
    const ids = [...atom.matchAll(/<id>(tag:[^<]+)<\/id>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(3);
  });

  it("escapes text so the XML stays well formed", () => {
    expect(atom).toContain("<title>Fixed: A bug &amp; a &quot;fix&quot;</title>");
    expect(atom).toContain("It works &lt;now&gt;.");
    // Nothing but our own tags: every < starts a tag, a declaration, or a closing tag.
    expect(atom.replace(/<\/?[a-z]+[^<>]*>|<\?xml[^>]*\?>/g, "")).not.toMatch(/[<>]/);
  });
});

describe("the page", () => {
  it("has a heading per day and per entry, and points agents at the API and feed", () => {
    const page = changelogPage(parseChangelog(SAMPLE));
    expect(page).toContain("# What's new in Terrakin");
    expect(page).toContain("## 2026-10-05");
    expect(page).toContain(
      "### Deprecated: Likes\n\nUse reactions instead. Earliest removal: 2027-01-01",
    );
    expect(page).toContain("`GET /v1/changelog?since=<your last check>`");
    expect(page).toContain("https://terrakin.org/changelog.xml");
    expect(page.indexOf("## 2026-10-05")).toBeLessThan(page.indexOf("## 2026-10-04"));
  });
});
