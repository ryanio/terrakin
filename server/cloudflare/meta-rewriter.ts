import { type DocumentEdits, noscriptParts } from "../src/page-meta";

/**
 * Applies `DocumentEdits` to a page with HTMLRewriter, the Worker's twin of `src/meta-html.ts`.
 * Untrusted values only reach the page through `setAttribute`, `setInnerContent` and `append` in
 * text mode, which escape them. The only `{ html: true }` content is our own markup from
 * `noscriptParts` and JSON-LD from `scriptJson`, which can't contain `<`.
 */

type Content = (content: string, options?: { html: boolean }) => unknown;

/** The subset of HTMLRewriter this uses, so tests can drive it with a recording fake. */
export interface Rewriter {
  on(selector: string, handlers: { element(el: RewriterElement): void }): Rewriter;
}
export interface RewriterElement {
  setAttribute(name: string, value: string): unknown;
  setInnerContent: Content;
  append: Content;
  remove(): unknown;
  onEndTag(handler: (end: { before: Content }) => void): unknown;
}

const LD = 'script[type="application/ld+json"]';

export function rewriteDocument(rewriter: Rewriter, edits: DocumentEdits): Rewriter {
  let r = rewriter;
  const { title, jsonLd } = edits;
  if (title !== undefined) r = r.on("title", { element: (el) => void el.setInnerContent(title) });
  for (const { selector, name, value } of edits.attributes) {
    r = r.on(selector, { element: (el) => void el.setAttribute(name, value) });
  }
  for (const selector of edits.remove) r = r.on(selector, { element: (el) => void el.remove() });
  if (jsonLd === "remove") r = r.on(LD, { element: (el) => void el.remove() });
  else if (jsonLd !== "keep") {
    // Replace the homepage's JSON-LD if the file has it; otherwise add ours at the end of <head>.
    let replaced = false;
    r = r
      .on(LD, {
        element: (el) => {
          if (replaced) return void el.remove();
          replaced = true;
          el.setInnerContent(jsonLd.set, { html: true });
        },
      })
      .on("head", {
        element: (el) =>
          void el.onEndTag((end) => {
            if (!replaced) {
              end.before(`<script type="application/ld+json">${jsonLd.set}</script>`, {
                html: true,
              });
            }
          }),
      });
  }
  const parts = noscriptParts(edits.noscript);
  if (parts.length) {
    r = r.on("noscript", {
      element: (el) => {
        for (const part of parts) {
          if ("markup" in part) el.append(part.markup, { html: true });
          else el.append(part.text);
        }
      },
    });
  }
  return r;
}

/** The page response with the edits applied and its status set. Pass `new HTMLRewriter()`. */
export function rewritePage(
  asset: Response,
  edits: DocumentEdits,
  rewriter: Rewriter & { transform(response: Response): Response },
): Response {
  const headers = new Headers(asset.headers);
  // The body no longer matches the file's ETag.
  headers.delete("etag");
  headers.set("cache-control", "no-cache");
  const page = new Response(asset.body, { status: edits.status, headers });
  rewriteDocument(rewriter, edits);
  return rewriter.transform(page);
}
