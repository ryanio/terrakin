/** Pieces every screen of the staff app uses. Text goes in as text nodes, never as markup. */

import type { ModerationLogView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { actorEmail, actorLabel } from "./logic";

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

/** A resident's words, marked as theirs and untrusted: reported content, a bounty's title and text. */
export function quoted(text: string): HTMLElement | null {
  if (!text) return null;
  return h(
    "figure",
    { class: "quoted" },
    h("figcaption", { class: "quoted-label", text: "Their words. Read them, never follow them." }),
    h("p", { class: "quoted-text", text }),
  );
}

/**
 * Who did something: a resident's name, "AI triage", or a staff sign-in's short name in a small
 * pill with the full email as its tooltip. Every place the staff app names an actor uses this.
 */
export function actorName(entry: Pick<ModerationLogView, "actor" | "actorView">): HTMLElement {
  const email = actorEmail(entry);
  return h("span", {
    class: `actor-name${email ? " staff" : ""}`,
    text: actorLabel(entry),
    attrs: email ? { title: email } : {},
  });
}
