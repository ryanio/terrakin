/**
 * Page chrome: the brand mark (the feed bar and the world landing) and the world landing's
 * "Bring your AI" popover. The home page shows its prompt in a card instead.
 */

import { copyButton } from "@terrakin/ui/ui";
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
  const setOpen = (open: boolean) => {
    pop.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => setOpen(pop.hidden === true));
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !(e.target instanceof Node && pop.parentElement?.contains(e.target)))
      setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      setOpen(false);
      button.focus();
    }
  });

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
