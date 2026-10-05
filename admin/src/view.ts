/** Pieces every screen of the staff app uses. Text goes in as text nodes, never as markup. */
import { h } from "@terrakin/ui/dom";

export interface View {
  el: HTMLElement;
  destroy(): void;
}

/** A centered card with a title, a line of text, and optional buttons or links. */
export function notice(title: string, body: string, ...actions: HTMLElement[]): HTMLElement {
  return h(
    "section",
    { class: "paper card state-card" },
    h("h2", { class: "state-title", text: title }),
    h("p", { class: "state-body", text: body }),
    actions.length ? h("div", { class: "state-actions" }, ...actions) : null,
  );
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
