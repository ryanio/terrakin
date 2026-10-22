/** Pieces every screen of the staff app uses. Text goes in as text nodes, never as markup. */

import type { ModerationLogView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { kindPill, type PillTone } from "@terrakin/ui/ui";
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

/**
 * The top of every staff screen, as the main app heads its pages: the screen's `page-title`, an
 * optional line beside it (the queue's count), a lede saying what the screen is for, and anything
 * that belongs with them (a button). Put it in a layout's head, or first in a `.column`.
 */
export function pageHead(o: {
  id: string;
  title: string;
  lede: string;
  aside?: HTMLElement;
  more?: readonly (HTMLElement | null)[];
}): HTMLElement {
  const title = h("h1", { class: "page-title", attrs: { id: o.id, tabindex: -1 }, text: o.title });
  return h(
    "header",
    { class: "stack tight page-head" },
    o.aside ? h("div", { class: "page-head-row" }, title, o.aside) : title,
    h("p", { class: "hint page-lede", text: o.lede }),
    ...(o.more ?? []),
  );
}

const STATE_TONES: Partial<Record<string, PillTone>> = {
  Live: "moss",
  "Dry run": "sun",
  Paused: "clay",
};

/**
 * Where a part of the town stands (Live, Dry run, Paused, Off) or a fact about it, as a pill: live
 * is moss, a dry run sun, paused clay, and anything else a quiet ink. The queue's Today card and
 * the townsfolk page both use it.
 */
export function statePill(text: string): HTMLSpanElement {
  return kindPill(text, STATE_TONES[text] ?? "ink", "state-chip");
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
