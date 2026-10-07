/**
 * A small Markdown to HTML renderer for our own pages in docs/site (About, Terms, Privacy, Contact,
 * the devlog), run at build time, and `markdownNodes`, the same output as DOM for the devlog card
 * on the home wall. It covers what those pages use: headings, paragraphs, lists, fenced code,
 * inline code, links, bare URLs, bold, and italics. Everything is escaped first, so it's safe on
 * any input, but it is not for resident text: that is never rendered as Markdown.
 */
import { h } from "@terrakin/ui/dom";

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only http(s), site-relative, and in-page links become hrefs. */
const safeHref = (href: string) => (/^(https?:\/\/|\/|#)/.test(href) ? href : "#");

/** Make a heading's text into an id, like GitHub does. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");

export function inline(text: string): string {
  const codes: string[] = [];
  // Code spans first, so nothing inside them is touched.
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  const links: string[] = [];
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    links.push(`<a href="${escapeHtml(safeHref(href))}">${inline(label)}</a>`);
    return `\uE001${links.length - 1}\uE001`;
  });
  out = escapeHtml(out)
    .replace(/\bhttps?:\/\/[^\s<]*[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
  return out
    .replace(/\uE001(\d+)\uE001/g, (_, i: string) => links[Number(i)] ?? "")
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)] ?? "");
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line) || /^<!--.*-->$/.test(line.trim())) {
      i++;
      continue;
    }
    const fence = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith(fence)) body.push(lines[i++] ?? "");
      i++;
      html.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      html.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    const list = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2] ?? "");
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i] ?? "");
        if (!item || /\d/.test(item[1] ?? "") !== ordered) break;
        items.push(`<li>${inline(item[2] ?? "")}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) {
        const cells = (lines[i] ?? "")
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim().replace(/\\\|/g, "|"));
        if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells);
        i++;
      }
      const [head = [], ...body] = rows;
      html.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i] ?? "") &&
      !/^(#{1,6}\s|`{3,}|~{3,}|\s*([-*]|\d+\.)\s|\||<!--)/.test(lines[i] ?? "")
    ) {
      paragraph.push(lines[i++] ?? "");
    }
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return html.join("\n");
}

/** The tags `markdownToHtml` writes, and the one attribute each may keep in the DOM. */
const NODE_TAGS: Readonly<Record<string, "href" | "class" | null>> = {
  h1: null,
  h2: null,
  h3: null,
  h4: null,
  h5: null,
  h6: null,
  p: null,
  ul: null,
  ol: null,
  li: null,
  pre: null,
  code: null,
  strong: null,
  em: null,
  a: "href",
  div: "class",
  table: null,
  thead: null,
  tbody: null,
  tr: null,
  th: null,
  td: null,
};

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const unescapeHtml = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/**
 * Markdown as DOM nodes, for a page that's already running (the devlog card). It reads
 * `markdownToHtml`'s output back, so both paths escape the same way, and builds each element with
 * `h()` and each run of text as a text node. Only the tags that renderer writes become elements,
 * with only `href` (through `safeHref` again) on links and `class` on table wrappers; anything else
 * is dropped. `shift` moves headings down, so a post's `##` sits under the card's own title.
 */
export function markdownNodes(markdown: string, shift = 0): Node[] {
  const top: Node[] = [];
  const open: { tag: string; el: HTMLElement }[] = [];
  const add = (node: Node) => {
    const parent = open.at(-1)?.el;
    if (parent) parent.append(node);
    else top.push(node);
  };
  const html = markdownToHtml(markdown);
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)((?: [a-z-]+="[^"]*")*)>|([^<]+)/g)) {
    const [, close, tag = "", attrs = "", text] = m;
    if (text !== undefined) {
      if (open.length > 0 || text.trim() !== "") add(document.createTextNode(unescapeHtml(text)));
      continue;
    }
    if (!(tag in NODE_TAGS)) continue;
    if (close) {
      const at = open.map((o) => o.tag).lastIndexOf(tag);
      if (at >= 0) open.length = at;
      continue;
    }
    const level = /^h([1-6])$/.exec(tag)?.[1];
    const name = level ? `h${Math.min(6, Number(level) + shift)}` : tag;
    const el = h(name as keyof HTMLElementTagNameMap);
    const keep = NODE_TAGS[tag];
    for (const [, key = "", value = ""] of attrs.matchAll(/ ([a-z-]+)="([^"]*)"/g)) {
      if (key !== keep) continue;
      const plain = unescapeHtml(value);
      el.setAttribute(key, key === "href" ? safeHref(plain) : plain);
    }
    add(el);
    open.push({ tag, el });
  }
  return top;
}
