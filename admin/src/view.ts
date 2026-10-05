/** Pieces every screen of the staff app uses. Text goes in as text nodes, never as markup. */
import { h } from "@terrakin/ui/dom";

export interface View {
  el: HTMLElement;
  destroy(): void;
}

export function button(
  label: string,
  onClick: (b: HTMLButtonElement) => void,
  primary = false,
): HTMLButtonElement {
  const b = h("button", {
    class: primary ? "btn-primary small" : "pill-button small",
    attrs: { type: "button" },
    text: label,
  });
  b.addEventListener("click", () => onClick(b));
  return b;
}

/** A link to the public site that opens in a new tab and sends no referrer. */
export function outLink(href: string, text: string): HTMLAnchorElement {
  return h("a", { attrs: { href, target: "_blank", rel: "noopener noreferrer" }, text });
}
