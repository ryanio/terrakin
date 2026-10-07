/**
 * Mentions and web addresses in post text: split cleaned text into plain pieces, `@handle` links,
 * and links (`links.ts`), and suggest handles while someone types. The text is another resident's
 * words, so it only ever becomes text nodes; a link is an anchor whose label is set with
 * textContent.
 */
import { type AuthorView, findMentions, type MentionView } from "@terrakin/protocol";
import { h } from "./dom";
import { findLinks, linkHref, linkLabel } from "./links";
import { profilePath } from "./paths";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; handle: string; id: string }
  | { kind: "link"; text: string };

/**
 * The text in order, with each web address and each `@handle` the server linked (in `mentions`)
 * as its own piece. Handles the server didn't link, and any inside an address, stay as they are.
 * Joining every piece's `text` gives back the original exactly.
 */
export function textSegments(text: string, mentions: readonly MentionView[] = []): Segment[] {
  const known = new Map(mentions.map((m) => [m.handle.toLowerCase(), m.id]));
  const links = findLinks(text);
  const pieces: (Segment & { start: number; end: number })[] = links.map((l) => ({
    kind: "link",
    text: l.url,
    start: l.start,
    end: l.end,
  }));
  for (const m of findMentions(text)) {
    const id = known.get(m.handle);
    if (!id || links.some((l) => m.start < l.end && l.start < m.end)) continue;
    const mention = text.slice(m.start, m.end);
    pieces.push({
      kind: "mention",
      text: mention,
      handle: m.handle,
      id,
      start: m.start,
      end: m.end,
    });
  }
  pieces.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const { start, end, ...piece } of pieces) {
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) });
    out.push(piece);
    at = end;
  }
  if (at < text.length || out.length === 0) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/**
 * Fill `parent` with the text, mentions and web addresses as links. An address shows its short
 * label (the whole address on hover) and leaves Terrakin through `/away`. Text nodes and
 * textContent only.
 */
export function appendRichText(
  parent: HTMLElement,
  text: string,
  mentions?: readonly MentionView[],
): HTMLElement {
  for (const seg of textSegments(text, mentions)) {
    if (seg.kind === "text") parent.append(document.createTextNode(seg.text));
    else if (seg.kind === "mention") {
      parent.append(
        h("a", { class: "mention", attrs: { href: profilePath(seg.id) }, text: seg.text }),
      );
    } else {
      parent.append(
        h("a", {
          class: "post-link",
          attrs: { href: linkHref(seg.text), title: seg.text, rel: "nofollow ugc" },
          text: linkLabel(seg.text),
        }),
      );
    }
  }
  return parent;
}

// ---------- typing a mention ----------

const TYPING = /(^|[^\p{L}\p{N}_@/])@([A-Za-z0-9_]{0,20})$/u;

/** The `@handle` being typed right before the caret: where its `@` sits and what's typed so far. */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = TYPING.exec(before);
  if (!m) return null;
  // Typing in the middle of a word (like an email) isn't a mention.
  const after = text.slice(caret, caret + 1);
  if (/[\p{L}\p{N}_]/u.test(after)) return null;
  const query = m[2] ?? "";
  return { start: before.length - query.length - 1, query: query.toLowerCase() };
}

/**
 * People to suggest for what's typed: those with a handle, handles that start with it first, then
 * names that contain it. At most `max`.
 */
export function suggestHandles(
  people: readonly AuthorView[],
  query: string,
  max = 5,
): (AuthorView & { handle: string })[] {
  const q = query.toLowerCase();
  const withHandle = people.filter((p): p is AuthorView & { handle: string } => !!p.handle);
  const starts = withHandle.filter((p) => p.handle.startsWith(q));
  const named = withHandle.filter(
    (p) => !p.handle.startsWith(q) && q !== "" && p.name.toLowerCase().includes(q),
  );
  return [...starts, ...named].slice(0, max);
}

/** The text with the mention at `start` (typed up to `caret`) replaced by `@handle `. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  handle: string,
): { text: string; caret: number } {
  const insert = `@${handle} `;
  const rest = text.slice(caret).replace(/^ /, "");
  return { text: text.slice(0, start) + insert + rest, caret: start + insert.length };
}
