/**
 * Shared bits for the feed pages: a toast, a full-screen overlay that the back gesture closes, and
 * copy-to-clipboard. Everything takes plain strings and sets them with textContent.
 */
import { h } from "./dom";

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short message at the bottom of the screen, with an optional link (for example "Join"). */
export function toast(text: string, link?: { href: string; label: string }) {
  const el = document.getElementById("site-toast");
  if (!el) return;
  el.replaceChildren(h("span", { text }));
  if (link)
    el.append(h("a", { class: "toast-link", text: link.label, attrs: { href: link.href } }));
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), link ? 4200 : 2600);
}

// ---------- overlay ----------

interface Open {
  dialog: HTMLDialogElement;
  onClosed: () => void;
  opener: Element | null;
}

let current: Open | undefined;
let swallowNextPop = false;

function teardown(o: Open) {
  if (o.dialog.open) o.dialog.close();
  o.dialog.remove();
  document.documentElement.classList.remove("overlay-open");
  o.onClosed();
  if (o.opener instanceof HTMLElement) o.opener.focus({ preventScroll: true });
}

/**
 * Show a full-screen dialog. It closes with its close button, Escape, or the back gesture: we push
 * a history entry for it, so back pops the overlay instead of leaving the page.
 */
export function openOverlay(dialog: HTMLDialogElement, onClosed: () => void = () => {}) {
  if (current) closeOverlay();
  const opener = document.activeElement;
  document.body.append(dialog);
  dialog.showModal();
  document.documentElement.classList.add("overlay-open");
  history.pushState({ ...(history.state ?? {}), overlay: true }, "");
  current = { dialog, onClosed, opener };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeOverlay();
  });
}

export function closeOverlay() {
  const o = current;
  if (!o) return;
  current = undefined;
  teardown(o);
  if ((history.state as { overlay?: boolean } | null)?.overlay) {
    swallowNextPop = true;
    history.back();
  }
}

/** For the router: true when a popstate belonged to an overlay (and we handled it). */
export function interceptPop(): boolean {
  if (swallowNextPop) {
    swallowNextPop = false;
    return true;
  }
  const o = current;
  if (!o) return false;
  current = undefined;
  teardown(o);
  return true;
}

// ---------- small popover ----------

let openPop: { el: HTMLElement; close(): void } | undefined;

/**
 * Show a small menu inside `host` (which is position: relative). It closes on a tap outside, on
 * Escape (focus goes back to `opener`), or when the caller calls the returned function. One at a
 * time: opening another closes this one.
 */
export function openPopover(host: HTMLElement, el: HTMLElement, opener: HTMLElement): () => void {
  openPop?.close();
  host.append(el);
  opener.setAttribute("aria-expanded", "true");
  const onDown = (e: PointerEvent) => {
    if (e.target instanceof Node && (el.contains(e.target) || opener.contains(e.target))) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    close();
    opener.focus({ preventScroll: true });
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    opener.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    if (openPop?.el === el) openPop = undefined;
  }
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  openPop = { el, close };
  el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  return close;
}

// ---------- copy ----------

/** Copy text, or select `fallback` so a long-press copy works. Returns true when it copied. */
export async function copyText(text: string, fallback?: Element): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return false;
  }
}

/** Share a page of ours: the system share sheet when there is one, else copy the link. */
export async function shareLink(path: string, title: string) {
  const url = new URL(path, location.origin).href;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, title });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  toast((await copyText(url)) ? "Link copied" : "Couldn't copy the link");
}
