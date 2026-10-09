/**
 * Loading placeholders: grey shapes where something will be, so a page keeps its layout while it
 * loads. They pulse softly (not at all under reduced motion) and are hidden from screen readers;
 * the container that waits says so with `aria-busy`. Styles are `.sk` and `.skeleton` in base.css.
 */
import { h } from "./dom";

/** Widths for a card's lines, so a stack of them doesn't look ruled. */
const WIDTHS = [92, 76, 84, 64, 70];

/** One grey bar, `width` percent wide (the whole line when left out). */
export function skLine(width?: number): HTMLElement {
  const line = h("span", { class: "sk sk-line" });
  // Through the CSSOM, which the staff app's policy allows where a style attribute isn't.
  if (width !== undefined) line.style.width = `${width}%`;
  return line;
}

/** A post's placeholder: avatar and name, two lines of text, and a picture on every third. */
export function skeletonPost(i = 0): HTMLElement {
  return h(
    "div",
    { class: "post paper skeleton", attrs: { "aria-hidden": "true" } },
    h("div", { class: "post-head" }, h("span", { class: "sk sk-avatar" }), skLine(38)),
    skLine(),
    skLine(WIDTHS[(i + 1) % WIDTHS.length]),
    i % 3 === 0 ? h("span", { class: "sk sk-media" }) : null,
  );
}

/** `n` post placeholders, for a list of posts or a page about to load. */
export function skeletonPosts(n = 3): HTMLElement[] {
  return Array.from({ length: n }, (_, i) => skeletonPost(i));
}

/**
 * A card's placeholder: a short heading line and `lines` of text, and a picture when `media`.
 * `cls` adds the classes of the card it stands in for, so it takes that card's place and size.
 */
export function skeletonCard(
  options: { lines?: number; media?: boolean; cls?: string } = {},
): HTMLElement {
  const { lines = 2, media = false, cls } = options;
  return h(
    "div",
    {
      class: `paper card skeleton${cls ? ` ${cls}` : ""}`,
      attrs: { "aria-hidden": "true" },
    },
    h("span", { class: "sk sk-line sk-heading" }),
    ...Array.from({ length: lines }, (_, i) => skLine(WIDTHS[i % WIDTHS.length])),
    media ? h("span", { class: "sk sk-media" }) : null,
  );
}

/** A blank card of the given classes, for a header or a panel that holds its own height. */
export function skeletonBlock(cls: string): HTMLElement {
  return h("div", { class: `paper card skeleton ${cls}`, attrs: { "aria-hidden": "true" } });
}
