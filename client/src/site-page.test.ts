import { readFileSync } from "node:fs";
import { PAGES, type SitePage } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { inline, markdownToHtml } from "./markdown";
import { markdownTwin, staticPage } from "./site-page";

const page = (path: string) =>
  (PAGES as readonly SitePage[]).find((p) => p.path === path) as SitePage;
const source = (name: string) =>
  readFileSync(new URL(`../../docs/site/${name}.md`, import.meta.url), "utf8");

describe("markdownToHtml", () => {
  it("renders the pieces our pages use", () => {
    expect(
      markdownToHtml(
        "# Title\n\nA [link](https://terrakin.org/about) and `code` and **bold**.\n\n- one\n- two\n\n1. first\n\n```\nPOST /v1/session\n```",
      ),
    ).toBe(
      [
        '<h1 id="title">Title</h1>',
        '<p>A <a href="https://terrakin.org/about">link</a> and <code>code</code> and <strong>bold</strong>.</p>',
        "<ul><li>one</li><li>two</li></ul>",
        "<ol><li>first</li></ol>",
        "<pre><code>POST /v1/session</code></pre>",
      ].join("\n"),
    );
  });

  it("escapes HTML and refuses script links", () => {
    expect(inline("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(inline("[x](javascript:alert(1))")).toBe('<a href="#">x</a>)');
    expect(inline('`<b>` "q"')).toBe("<code>&lt;b&gt;</code> &quot;q&quot;");
  });

  it("links bare URLs without swallowing the full stop", () => {
    expect(inline("See https://terrakin.org/privacy.")).toBe(
      'See <a href="https://terrakin.org/privacy">https://terrakin.org/privacy</a>.',
    );
  });

  it("leaves underscores inside words alone", () => {
    expect(inline("rate_limited and _this_")).toBe("rate_limited and <em>this</em>");
  });
});

describe("static pages", () => {
  const statics = (PAGES as readonly SitePage[]).flatMap((p) =>
    p.kind === "static" && p.prose ? [p.prose] : [],
  );

  it.each(statics)("%s is a real page with its twin and the changelog feed linked", (name) => {
    const meta = page(`/${name}`);
    const html = staticPage({
      page: meta,
      source: source(name),
      lastUpdated: "2026-10-04",
      css: "/assets/index.css",
    });
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="https://terrakin.org/${name}" />`);
    expect(html).toContain(`<link rel="alternate" type="text/markdown" href="/${name}.md"`);
    expect(html).toContain(
      '<link rel="alternate" type="application/atom+xml" href="/changelog.xml"',
    );
    expect(html).toContain(`<a href="/changelog">What's new</a>`);
    expect(html).toContain(`<a href="/terms">Terms</a>`);
    expect(html).not.toMatch(/<script/);
    // At least 500 characters of real text, not counting markup.
    const text = html.replace(/<head>[\s\S]*<\/head>/, "").replace(/<[^>]+>/g, " ");
    expect(text.replace(/\s+/g, " ").length).toBeGreaterThan(1500);
  });

  it("renders the changelog with a heading per day, so entries can link to their day", () => {
    const html = staticPage({
      page: page("/changelog"),
      source: source("changelog"),
      lastUpdated: "2026-10-04",
      css: "/assets/index.css",
    });
    expect(html).toContain('<h1 id="whats-new-in-terrakin">');
    expect(html).toContain('<h2 id="2026-10-04">2026-10-04</h2>');
    expect(html).toContain('<h2 id="2026-10-02">2026-10-02</h2>');
    expect(html).toMatch(
      /<h3 id="added-a-changelog-for-agents">Added: A changelog for agents<\/h3>/,
    );
  });

  it("gives every Markdown twin frontmatter: title, description, canonical, last-updated", () => {
    const twin = markdownTwin(page("/pricing.md"), source("pricing"), "2026-10-04");
    expect(twin).toMatch(
      /^---\ntitle: "Pricing · Terrakin"\ndescription: ".+"\ncanonical: https:\/\/terrakin\.org\/pricing\.md\nlast-updated: 2026-10-04\n---\n\n# Pricing\n/,
    );
  });

  it("says what decision 0015 and RFC 0003 say on the privacy page", () => {
    const privacy = source("privacy");
    for (const fact of [
      "`/r/:id`",
      "empty referrer",
      "Two events",
      "Google signals and ad personalization are off",
      "token is scrubbed",
      "not to store IP addresses",
      "don't store IP addresses with posts",
      "EXIF",
      "long random address",
      "SHA-256",
      "local storage",
    ]) {
      expect(privacy).toContain(fact);
    }
  });
});
