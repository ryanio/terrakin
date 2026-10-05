/**
 * Mentions in post text: split cleaned text into plain pieces and `@handle` links, and suggest
 * handles while someone types. The text is another resident's words, so it only ever becomes text
 * nodes; a link is an anchor whose label is set with textContent.
 */
import { type AuthorView, findMentions, type MentionView } from "@terrakin/protocol";
import { h } from "./dom";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; handle: string; id: string };

/**
 * The text in order, with each `@handle` the server linked (in `mentions`) as its own piece.
 * Handles the server didn't link stay plain text. Joining every piece's `text` gives back the
 * original exactly.
 */
export function textSegments(text: string, mentions: readonly MentionView[] = []): Segment[] {
  const known = new Map(mentions.map((m) => [m.handle.toLowerCase(), m.id]));
  const out: Segment[] = [];
  let at = 0;
  for (const m of findMentions(text)) {
    const id = known.get(m.handle);
    if (!id) continue;
    if (m.start > at) out.push({ kind: "text", text: text.slice(at, m.start) });
    out.push({ kind: "mention", text: text.slice(m.start, m.end), handle: m.handle, id });
    at = m.end;
  }
  if (at < text.length || out.length === 0) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/**
 * Where a mention links: the profile of the resident the server resolved when the post was made,
 * by id. Never by handle, so an old mention can't point at whoever takes the handle after its hold.
 */
export const mentionPath = (id: string) => `/r/${encodeURIComponent(id)}`;

/** Fill `parent` with the text, mentions as links. Text nodes and textContent only. */
export function appendRichText(
  parent: HTMLElement,
  text: string,
  mentions?: readonly MentionView[],
): HTMLElement {
  for (const seg of textSegments(text, mentions)) {
    parent.append(
      seg.kind === "text"
        ? document.createTextNode(seg.text)
        : h("a", { class: "mention", attrs: { href: mentionPath(seg.id) }, text: seg.text }),
    );
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
