import { readFileSync } from "node:fs";
import { PAGES, type SitePage } from "@terrakin/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { inline, markdownNodes, markdownToHtml } from "./markdown";
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

/** Just enough DOM for `h()` and text nodes. Setting innerHTML anywhere fails the test. */
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  className = "";
  constructor(
    readonly tag: string,
    public textContent = "",
  ) {}
  set innerHTML(_: string) {
    throw new Error("innerHTML used");
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
}
const fakeDocument = {
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => new FakeNode("#text", text),
};
/** Every element and attribute under `nodes`, as `tag` and `tag[name=value]` lines. */
const shape = (nodes: FakeNode[]): string[] =>
  nodes.flatMap((n) => [
    n.tag,
    ...Object.entries(n.attrs).map(([k, v]) => `${n.tag}[${k}=${v}]`),
    ...shape(n.children),
  ]);
const text = (nodes: FakeNode[]): string =>
  nodes.map((n) => (n.tag === "#text" ? n.textContent : text(n.children))).join("");

describe("markdownNodes, the devlog card's Markdown", () => {
  const saved = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = saved;
  });
  const render = (markdown: string, shift = 0) => {
    (globalThis as { document?: unknown }).document = fakeDocument;
    return markdownNodes(markdown, shift) as unknown as FakeNode[];
  };

  it("builds the elements a post uses, with its headings moved under the card's title", () => {
    const nodes = render("## Your place\n\nA **pet** and [a link](/visit).\n\n- one", 1);
    expect(shape(nodes)).toEqual([
      "h3",
      "#text",
      "p",
      "#text",
      "strong",
      "#text",
      "#text",
      "a",
      "a[href=/visit]",
      "#text",
      "#text",
      "ul",
      "li",
      "#text",
    ]);
    expect(text(nodes)).toBe("Your placeA pet and a link.one");
  });

  it("can't be made to run script: markup stays text and script links go nowhere", () => {
    const hostile = [
      '<script>alert(1)</script> <img src=x onerror="alert(1)"> <a href="javascript:alert(1)">x</a>',
      "",
      "[click](javascript:alert(1)) [data](data:text/html,hi) `<b>code</b>`",
    ].join("\n");
    const nodes = render(hostile);
    const tags = shape(nodes);
    expect(tags.filter((t) => !t.startsWith("#"))).toEqual([
      "p",
      "p",
      "a",
      "a[href=#]",
      "a",
      "a[href=#]",
      "code",
    ]);
    expect(text(nodes)).toContain('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    expect(text(nodes)).toContain("<b>code</b>");
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
