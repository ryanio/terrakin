/**
 * Unsent words in the post, reply, quote, and letter boxes, kept in sessionStorage so leaving the
 * page or closing the quote sheet doesn't lose them. Only this tab sees them, and they go when it
 * closes. Storage can be missing or full (private windows, blocked site data), so every read and
 * write gives up quietly.
 */

/** What a draft is for: a new post, a reply to a post, a quote of a post, or a letter to someone. */
export type DraftFor =
  | { mode: "post" }
  | { mode: "reply"; id: string }
  | { mode: "quote"; id: string }
  | { mode: "letter"; id: string };

type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function draftKey(target: DraftFor): string {
  return target.mode === "post"
    ? "terrakin.draft.post"
    : `terrakin.draft.${target.mode}.${target.id}`;
}

function session(): DraftStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadDraft(target: DraftFor, store: DraftStore | undefined = session()): string {
  try {
    return store?.getItem(draftKey(target)) ?? "";
  } catch {
    return "";
  }
}

/** Keep `text` for next time, or forget the draft when it's only whitespace. */
export function saveDraft(
  target: DraftFor,
  text: string,
  store: DraftStore | undefined = session(),
): void {
  try {
    if (text.trim()) store?.setItem(draftKey(target), text);
    else store?.removeItem(draftKey(target));
  } catch {
    // Full or blocked: the draft just isn't kept.
  }
}

export function clearDraft(target: DraftFor, store: DraftStore | undefined = session()): void {
  saveDraft(target, "", store);
}
