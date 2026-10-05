/**
 * Page chrome: the brand mark (the feed bar and the world landing) and the world landing's
 * "Bring your AI" popover. The home page shows its prompt in a card instead.
 */

import { copyButton, dropdown } from "@terrakin/ui/ui";
import { track } from "./telemetry";

/** Use the real brand mark when it loads; otherwise keep the inline drawing next to it. */
export function initBrandMarks(root: ParentNode = document) {
  for (const img of root.querySelectorAll<HTMLImageElement>(".mark img")) {
    const drop = () => img.remove();
    if (img.complete && img.naturalWidth === 0) drop();
    else img.addEventListener("error", drop, { once: true });
  }
}

/**
 * The "Bring your AI" popover: one line an assistant can follow. Reusable by any page header that
 * has the same button + popover markup (`.copy-text` line and a `.copy-button` inside the popover).
 */
export function initBringAi(button: HTMLElement, pop: HTMLElement) {
  dropdown(button, pop, pop.parentElement ?? pop);

  const line = pop.querySelector<HTMLElement>(".copy-text");
  const copy = pop.querySelector<HTMLButtonElement>(".copy-button");
  const label = copy?.querySelector<HTMLElement>(".copy-label");
  if (!line || !copy || !label) return;
  // Collapse whitespace so the copied text is always one line.
  copyButton(copy, label, () => (line.textContent ?? "").replace(/\s+/g, " ").trim(), {
    idle: "Copy",
    fallback: line,
    onChange: (state) => {
      if (state === "copied") track("bring_ai_copy");
    },
  });
}
