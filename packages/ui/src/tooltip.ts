/**
 * Tooltips: a few words that fade in over a small label (the "Townsfolk" and "AI" pills, karma) to
 * say what it means. `tip` marks the label; the bubble and its listeners (tooltip-bubble.ts) load
 * the first time one is marked, so they stay out of the first load.
 */

let wiring: Promise<void> | undefined;

/** Give `el` a tooltip. The words are plain text, and screen readers get them as its description. */
export function tip<T extends HTMLElement>(el: T, text: string): T {
  el.dataset.tip = text;
  el.setAttribute("aria-description", text);
  wiring ??= import("./tooltip-bubble").then(
    (m) => m.wireTooltips(),
    () => {
      wiring = undefined;
    },
  );
  return el;
}
