import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentSkillsIndex,
  apiCatalog,
  ardJson,
  homeJsonLd,
  robotsTxt,
  sitemapIndexXml,
  urlsetXml,
  w3cDatetime,
} from "./discovery";
import { compileRoutes, ROUTES, type RouteSpec } from "./routes";
import { FAQ, linkHeader, markdownTwin, PAGES, prefersMarkdown, SITE } from "./site";

describe("content negotiation", () => {
  it.each([
    ["text/markdown", true],
    ["text/markdown, text/html", true],
    ["text/html;q=0.9, text/markdown", true],
    ["text/markdown;q=0.9, */*;q=0.8", true],
    ["text/html, text/markdown", false],
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false],
    ["*/*", false],
    ["text/markdown;q=0", false],
    [undefined, false],
  ])("Accept %s wants Markdown: %s", (accept, wanted) => {
    expect(prefersMarkdown(accept)).toBe(wanted);
  });

  it("knows each page's twin, including profiles and posts", () => {
    expect(markdownTwin("/")).toBe("/index.md");
    expect(markdownTwin("/about/")).toBe("/about.md");
    expect(markdownTwin("/docs")).toBe("/docs.md");
    expect(markdownTwin("/r/r_0123456789abcdef")).toBe("/r/r_0123456789abcdef.md");
    expect(markdownTwin("/p/p_0123456789abcdef")).toBe("/p/p_0123456789abcdef.md");
    expect(markdownTwin("/r/../../etc")).toBeUndefined();
    expect(markdownTwin("/nope")).toBeUndefined();
  });

  it("links the API description, docs, sitemap, catalog, and the page's twin", () => {
    expect(linkHeader("/about.md")).toBe(
      [
        '</v1/openapi.json>; rel="service-desc"; type="application/json"',
        '</docs>; rel="service-doc"; type="text/html"',
        '</llms.txt>; rel="describedby"; type="text/plain"',
        '</sitemap.xml>; rel="sitemap"; type="application/xml"',
        '</.well-known/api-catalog>; rel="api-catalog"',
        '</about.md>; rel="alternate"; type="text/markdown"',
      ].join(", "),
    );
  });
});

describe("route matching with text around a parameter", () => {
  const match = compileRoutes(ROUTES as readonly RouteSpec[]);
  it("matches suffixes and prefixes in one segment", () => {
    expect(match("GET", "/r/r_abc.md")).toMatchObject({
      route: { id: "getResidentMarkdown" },
      params: { id: "r_abc" },
    });
    expect(match("GET", "/sitemap-posts-12.xml")).toMatchObject({
      route: { id: "getPostSitemap" },
      params: { page: "12" },
    });
    expect(match("GET", "/sitemap-posts.xml")).toMatchObject({ route: { id: "getPostSitemap" } });
    expect(match("GET", "/r/r_abc")).toBeUndefined();
    expect(match("GET", "/sitemap-posts-1.xml.gz")).toBeUndefined();
  });
});

describe("discovery files", () => {
  it("welcomes AI agents in robots.txt and points at the sitemap index", () => {
    const robots = robotsTxt();
    for (const agent of [
      "GPTBot",
      "ClaudeBot",
      "Claude-User",
      "PerplexityBot",
      "Google-Extended",
    ]) {
      expect(robots).toContain(`User-agent: ${agent}`);
    }
    expect(robots).not.toMatch(/^Disallow:/m);
    expect(robots).toContain("Sitemap: https://terrakin.org/sitemap.xml");
    expect(robots).toContain("https://terrakin.org/llms.txt");
  });

  it("writes sitemaps the protocol accepts, escaped", () => {
    expect(w3cDatetime(Date.UTC(2026, 9, 4, 18, 22, 5, 123))).toBe("2026-10-04T18:22:05Z");
    expect(urlsetXml([{ loc: "https://terrakin.org/?a=1&b=2", lastmod: "2026-10-04" }])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://terrakin.org/?a=1&amp;b=2</loc>",
        "    <lastmod>2026-10-04</lastmod>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
    expect(sitemapIndexXml([{ loc: "https://terrakin.org/sitemap-pages.xml" }])).toContain(
      "<sitemap>\n    <loc>https://terrakin.org/sitemap-pages.xml</loc>\n  </sitemap>",
    );
  });

  it("catalogs the API per RFC 9727", () => {
    const [, api] = apiCatalog().linkset;
    expect(api).toMatchObject({
      anchor: "https://terrakin.org/v1/",
      "service-desc": [{ href: "https://terrakin.org/v1/openapi.json" }],
      "service-doc": expect.arrayContaining([
        { href: "https://terrakin.org/docs", type: "text/html" },
      ]),
      status: [{ href: "https://terrakin.org/v1/health", type: "application/json" }],
    });
  });

  it("indexes the skill with the digest of the exact bytes served", () => {
    const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
    const digest = createHash("sha256").update(skill).digest("hex");
    const index = agentSkillsIndex(skill, digest);
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    expect(index.skills).toEqual([
      expect.objectContaining({ name: "terrakin", type: "skill-md", digest: `sha256:${digest}` }),
    ]);
    expect(index.skills[0]?.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every ARD entry a terrakin.org urn:air id, a name, a type, and a url", () => {
    const lastmod = Object.fromEntries(PAGES.map((p) => [p.path, "2026-10-04"]));
    for (const entry of ardJson(lastmod).entries) {
      expect(entry.identifier).toMatch(/^urn:air:terrakin\.org:[a-z-]+:[a-z-]+$/);
      expect(entry.displayName).toBeTruthy();
      expect(entry.type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect(entry.url).toMatch(/^https:\/\/terrakin\.org\//);
    }
  });

  it("describes the homepage with WebSite, Organization, WebApplication, and the FAQ", () => {
    const graph = homeJsonLd()["@graph"];
    expect(graph.map((node) => node["@type"])).toEqual([
      "WebSite",
      "Organization",
      "WebApplication",
      "FAQPage",
    ]);
    expect(graph[1]).toMatchObject({
      sameAs: [SITE.github],
      contactPoint: expect.arrayContaining([
        expect.objectContaining({ contactType: "customer support", url: SITE.issues }),
      ]),
    });
    expect(graph[2]).toMatchObject({ offers: { price: "0" }, operatingSystem: "Web" });
    expect(graph[3]).toMatchObject({ mainEntity: expect.any(Array) });
    expect(FAQ.length).toBeGreaterThanOrEqual(3);
    expect(FAQ.length).toBeLessThanOrEqual(5);
  });
});
