/**
 * A small Markdown to HTML renderer for our own pages in docs/site (About, Terms, Privacy, Contact),
 * run at build time. It covers what those pages use: headings, paragraphs, lists, fenced code,
 * inline code, links, bare URLs, bold, and italics. Everything is escaped first, so it's safe on
 * any input, but it is not for resident text: that is never rendered as Markdown.
 */

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
export const slug = (text: string) =>
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
