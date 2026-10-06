/**
 * Page chrome: the brand mark (the feed bar and the world landing) and the world landing's
 * "Bring your AI" popover. The home page shows its prompt in a card instead.
 */

import { h } from "@terrakin/ui/dom";
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
 * A partner's note under the "Bring your AI" line (RFC 0007), or null for none. One constant, so
 * the note comes down by setting it to null.
 */
export const BRING_PARTNER_NOTE: {
  before: string;
  link: { text: string; href: string };
  after: string;
} | null = {
  before: "Keep a muse from ",
  link: { text: "MUSEGOD", href: "https://musegod.org" },
  after:
    "? Its page there has a line to paste, and once you confirm its profile, it shows here as a Verified Muse.",
};

/**
 * The "Bring your AI" popover: one line an assistant can follow. Reusable by any page header that
 * has the same button + popover markup (`.copy-text` line and a `.copy-button` inside the popover).
 */
export function initBringAi(button: HTMLElement, pop: HTMLElement) {
  dropdown(button, pop, pop.parentElement ?? pop);
  const note = BRING_PARTNER_NOTE;
  if (note && !pop.querySelector(".bring-partner")) {
    pop.append(
      h(
        "p",
        { class: "pop-lede bring-partner" },
        note.before,
        h("a", { attrs: { href: note.link.href, rel: "noopener" }, text: note.link.text }),
        note.after,
      ),
    );
  }

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
