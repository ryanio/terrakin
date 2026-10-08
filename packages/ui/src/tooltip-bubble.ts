/**
 * The tooltip's bubble (tooltip.ts marks the labels): one small dark bubble for the whole page,
 * showing the words of whichever label is pointed at. A mouse resting on a label shows it after a
 * moment; a tap shows it on a phone, unless the label sits in a link or button, where a tap does
 * that instead. Escape, a scroll, or pointing elsewhere puts it away. Loaded the first time a
 * label gets a tooltip, so it stays out of the first load.
 */
import { h } from "./dom";

/** How long a mouse rests on a label before its words show. */
const SHOW_MS = 350;
/** Moving from one label to the next within this long shows the next at once. */
const WARM_MS = 600;
/** Time to cross the gap from the label to the bubble before it goes. */
const LINGER_MS = 120;
/** Room between the label and the bubble, and between the bubble and the screen's edge. */
const GAP = 8;
const EDGE = 8;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the bubble goes: centered over the label, flipped under it when there's no room above,
 * and kept on the screen. `arrow` is how far from the bubble's left edge its point sits, so it
 * still points at the label when the bubble is pushed in from an edge.
 */
export function tipPlace(
  anchor: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number; below: boolean; arrow: number } {
  const mid = (anchor.left + anchor.right) / 2;
  const max = Math.max(EDGE, view.width - EDGE - size.width);
  const left = Math.min(Math.max(mid - size.width / 2, EDGE), max);
  const below = anchor.top - GAP - size.height < EDGE;
  const top = below ? anchor.bottom + GAP : anchor.top - GAP - size.height;
  const arrow = Math.min(Math.max(mid - left, 12), size.width - 12);
  return { left, top, below, arrow };
}

let bubble: HTMLElement | undefined;
let words: HTMLElement | undefined;
let current: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let lastShown = 0;

const tipOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;

function show(el: HTMLElement) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  if (!bubble || !words) {
    words = h("span");
    bubble = h(
      "div",
      // Screen readers already have the words from the label's own description.
      { class: "tooltip", attrs: { "aria-hidden": "true" } },
      words,
      h("span", { class: "tooltip-arrow", attrs: { "aria-hidden": "true" } }),
    );
    bubble.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    bubble.addEventListener("pointerleave", () => hideSoon());
  }
  if (!bubble.isConnected) document.body.append(bubble);
  current = el;
  words.textContent = text;
  const place = tipPlace(
    el.getBoundingClientRect(),
    { width: bubble.offsetWidth, height: bubble.offsetHeight },
    { width: document.documentElement.clientWidth, height: window.innerHeight },
  );
  bubble.style.left = `${place.left}px`;
  bubble.style.top = `${place.top}px`;
  bubble.style.setProperty("--tip-arrow", `${place.arrow}px`);
  bubble.classList.toggle("below", place.below);
  bubble.classList.add("show");
  lastShown = Date.now();
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!current) return;
  current = null;
  bubble?.classList.remove("show");
  lastShown = Date.now();
}

function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, LINGER_MS);
}

/** One set of listeners for the whole page. tooltip.ts calls it once. */
export function wireTooltips() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    if (bubble?.contains(e.target as Node)) return;
    const el = tipOf(e.target);
    if (el === current) {
      clearTimeout(hideTimer);
      return;
    }
    clearTimeout(showTimer);
    if (!el) {
      if (current) hideSoon();
      return;
    }
    const warm = current !== null || Date.now() - lastShown < WARM_MS;
    if (warm) show(el);
    else showTimer = setTimeout(() => show(el), SHOW_MS);
  });
  document.addEventListener("pointerout", (e) => {
    // Off the page altogether.
    if (e.pointerType === "mouse" && !e.relatedTarget) {
      clearTimeout(showTimer);
      hideSoon();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (bubble?.contains(e.target as Node)) return;
    const el = tipOf(e.target);
    if (e.pointerType === "mouse") {
      if (el !== current) hide();
      return;
    }
    // In a link or a button, the tap is for that.
    if (el && !el.closest("a, button") && el !== current) show(el);
    else hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target instanceof HTMLElement && e.target.dataset.tip ? e.target : null;
    if (el) show(el);
    else if (current) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) hide();
  });
  document.addEventListener("scroll", () => current && hide(), { capture: true, passive: true });
  window.addEventListener("resize", () => current && hide());
}
