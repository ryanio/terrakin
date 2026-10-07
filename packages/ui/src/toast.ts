/**
 * The toast: a short message at the bottom of the screen. Its own module, with nothing but the DOM
 * helper, so a page without the app can load it (decision 0211). `ui.ts` re-exports it.
 */
import { h } from "./dom";

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastHeld = false;
let toastFor = 0;
const toastWired = new WeakSet<HTMLElement>();

/**
 * How long a toast stays up: longer for longer words, and longer with a link, so someone on a
 * keyboard has time to reach it.
 */
export function toastMs(text: string, link = false): number {
  return Math.max(link ? 8000 : 4000, text.length * 60);
}

/**
 * A short message at the bottom of the screen, with an optional link (for example "Join"). It
 * waits while the pointer is on it or focus is in it.
 */
export function toast(text: string, link?: { href: string; label: string }) {
  const el = document.getElementById("site-toast");
  if (!el) return;
  el.replaceChildren(h("span", { text }));
  if (link)
    el.append(h("a", { class: "toast-link", text: link.label, attrs: { href: link.href } }));
  el.classList.add("show");
  if (!toastWired.has(el)) {
    toastWired.add(el);
    const hold = () => {
      toastHeld = true;
      clearTimeout(toastTimer);
    };
    const release = () => {
      // Still pointed at or focused: keep holding.
      if (el.matches(":hover, :focus-within")) return;
      toastHeld = false;
      if (el.classList.contains("show")) hideToastIn(el, toastFor);
    };
    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
  }
  toastFor = toastMs(text, Boolean(link));
  // Replacing a focused link sends no focusout, so ask again rather than trust the old hold.
  toastHeld = el.matches(":hover, :focus-within");
  if (!toastHeld) hideToastIn(el, toastFor);
}

function hideToastIn(el: HTMLElement, ms: number) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
