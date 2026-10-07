import { type DocumentEdits, noscriptParts } from "./page-meta";

/**
 * Applies `DocumentEdits` to index.html as a string, for the Node server. The Worker does the same
 * with HTMLRewriter (cloudflare/meta-rewriter.ts). Every value is escaped here: attribute values
 * with `escapeAttr`, text with `escapeText`, and JSON-LD arrives already script-safe.
 */

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** `meta[name="description"]` and friends: the only selector shape the edits use. */
const SELECTOR = /^(meta|link)\[(name|property|rel)="([^"]+)"\]$/;

/** The opening tag `selector` names in `html`, as a regex match, or undefined. */
function findTag(html: string, selector: string): RegExpExecArray | undefined {
  const s = SELECTOR.exec(selector);
  if (!s) throw new Error(`Unsupported selector: ${selector}`);
  const [, tag, attr, value] = s;
  const re = new RegExp(
    `<${tag}\\b[^>]*\\b${attr}="${value?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
    "i",
  );
  return re.exec(html) ?? undefined;
}

function setAttribute(tag: string, name: string, value: string): string {
  const escaped = `${name}="${escapeAttr(value)}"`;
  const re = new RegExp(`\\b${name}="[^"]*"`);
  if (re.test(tag)) return tag.replace(re, () => escaped);
  return tag.replace(/\s*\/?>$/, (end) => ` ${escaped}${end}`);
}

export function applyEdits(html: string, edits: DocumentEdits): string {
  const { title } = edits;
  let out =
    title === undefined
      ? html
      : html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeText(title)}</title>`);
  for (const { selector, name, value } of edits.attributes) {
    const found = findTag(out, selector);
    if (!found) continue;
    const next = setAttribute(found[0], name, value);
    out = out.slice(0, found.index) + next + out.slice(found.index + found[0].length);
  }
  for (const selector of edits.remove) {
    const found = findTag(out, selector);
    if (found) out = out.slice(0, found.index) + out.slice(found.index + found[0].length);
  }
  const ld = /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/i;
  if (edits.jsonLd === "remove") out = out.replace(ld, "");
  else if (edits.jsonLd !== "keep") {
    const script = `<script type="application/ld+json">${edits.jsonLd.set}</script>`;
    out = ld.test(out)
      ? out.replace(ld, (m) => m.replace(/<script[\s\S]*$/, () => script))
      : out.replace(/<\/head>/i, (end) => `  ${script}\n  ${end}`);
  }
  const parts = noscriptParts(edits.noscript);
  if (parts.length) {
    const body = parts.map((p) => ("markup" in p ? p.markup : escapeText(p.text))).join("");
    out = out.replace(/<\/noscript>/i, (end) => body + end);
  }
  return out;
}
