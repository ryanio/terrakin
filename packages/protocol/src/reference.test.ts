import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routes } from "./docs";
import {
  apiAreaMarkdown,
  apiModelsMarkdown,
  apiPageMarkdown,
  docsPage,
  docsPageMarkdown,
  headingId,
} from "./reference";
import { TAGS, type TagName } from "./routes";
import { API_AREAS, apiAreaPath, LINKS } from "./site";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const openapi = JSON.parse(read("../openapi.json")) as Record<string, unknown>;
const guides = read("../../client/src/docs/guides.generated.md");

/** The id of every heading outside fenced code. */
const ids = (markdown: string) => {
  const found = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6} (.+)$/.exec(line);
    if (heading?.[1]) found.add(headingId(heading[1]));
  }
  return found;
};
const h1s = (markdown: string) => markdown.split("\n").filter((line) => /^# /.test(line));
const links = (markdown: string, prefix: string) =>
  [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((href) => href.startsWith(prefix))
    .map((href) => href.slice(prefix.length));

const pages = API_AREAS.map((area) => ({ area, markdown: apiAreaMarkdown(area, openapi) }));
const models = apiModelsMarkdown(openapi);

describe("the API reference", () => {
  it("has a page for every tag but Live, the WebSocket, which has no HTTP routes", () => {
    expect([...API_AREAS, "Live"].sort()).toEqual(Object.keys(TAGS).sort());
    expect(routes.some((r) => r.tags[0] === "Live")).toBe(false);
  });

  it("lists every public route once, under its first tag", () => {
    const listed = pages.flatMap(({ markdown }) =>
      markdown.split("\n").filter((line) => /^## (GET|POST|PUT|DELETE) /.test(line)),
    );
    expect(listed.sort()).toEqual(routes.map((r) => `## ${r.method} ${r.path}`).sort());
  });

  it("gives each page one title", () => {
    for (const { area, markdown } of pages) expect(h1s(markdown), area).toEqual([`# ${area}`]);
    expect(h1s(models)).toEqual(["# Models"]);
  });

  it("links only to headings that exist, on the page itself or in Models", () => {
    const modelIds = ids(models);
    for (const { area, markdown } of pages) {
      const own = ids(markdown);
      for (const anchor of links(markdown, "#"))
        expect(own.has(anchor), `${area} #${anchor}`).toBe(true);
      const into = links(markdown, `${LINKS.apiModels}#`);
      for (const anchor of into) expect(modelIds.has(anchor), `${area} → ${anchor}`).toBe(true);
    }
    for (const anchor of links(models, `${LINKS.apiModels}#`)) {
      expect(modelIds.has(anchor), anchor).toBe(true);
    }
  });

  it("says what a route needs, takes, answers, and refuses", () => {
    const world = apiAreaMarkdown("World", openapi);
    const session = world.slice(world.indexOf("## POST /v1/session"), world.indexOf("## DELETE"));
    expect(session).toContain("- No token.");
    expect(session).toContain("- Limit: 3 a minute per IP");
    expect(session).toContain("| `name` | string, up to 24 characters, required |");
    expect(session).toContain("**Answer (201)**");
    expect(session).toContain("`name_taken` (400)");
  });

  it("shows each world event under its type in Models", () => {
    const events = models.slice(
      models.indexOf("## WorldEvent"),
      models.indexOf("\n## ", models.indexOf("## WorldEvent") + 1),
    );
    expect(events).toContain("### `moved`");
  });

  it("answers for every page PAGES lists under /docs/api, and nothing else", () => {
    for (const area of API_AREAS as TagName[]) {
      expect(apiPageMarkdown(apiAreaPath(area), openapi)).toContain(`# ${area}`);
    }
    expect(apiPageMarkdown(LINKS.apiModels, openapi)).toBe(models);
    expect(() => apiPageMarkdown("/docs/api/nowhere", openapi)).toThrow(/nowhere/);
  });
});

describe("/docs", () => {
  const docs = docsPageMarkdown(guides);

  it("has one title, with every guide a section under it", () => {
    expect(h1s(docs)).toEqual(["# Terrakin docs"]);
    expect(docs).toContain("\n## Getting started for people\n");
    expect(docs).toContain("\n## API reference\n");
  });

  it("says a line about every guide in its contents", () => {
    for (const entry of docsPage(guides).toc.entries) expect(entry.note, entry.label).toBeTruthy();
  });

  it("links to every area of the reference, and in-page only to its own headings", () => {
    for (const area of API_AREAS) expect(docs).toContain(`](${apiAreaPath(area)})`);
    const own = ids(docs);
    for (const anchor of links(docs, "#")) expect(own.has(anchor), anchor).toBe(true);
  });
});
