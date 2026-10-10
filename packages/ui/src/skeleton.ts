/**
 * Loading placeholders: grey shapes where something will be, so a page keeps its layout while it
 * loads. They fade in after a short wait, breathe faintly (not at all under reduced motion), and
 * are hidden from screen readers; the container that waits says so with `aria-busy`. Styles are
 * `.sk` and `.skeleton` in base.css.
 */
import { h } from "./dom";
import { pageLayout, wideLayout } from "./ui";

/** Widths for a card's lines, so a stack of them doesn't look ruled. */
const WIDTHS = [92, 76, 84, 64, 70] as const;

/** The `i`th width, going around. */
const width = (i: number) => WIDTHS[i % WIDTHS.length] ?? 80;

const times = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

/** One grey shape: `sk-avatar`, `sk-media`, and the rest of the `.sk-*` shapes in base.css. */
const shape = (cls: string) => h("span", { class: `sk ${cls}` });

/** A placeholder's frame, hidden from screen readers. */
const frame = (cls: string, ...children: (Node | null)[]) =>
  h("div", { class: `paper skeleton ${cls}`, attrs: { "aria-hidden": "true" } }, ...children);

/** One grey bar, `width` percent wide (the whole line when left out). */
export function skLine(width?: number): HTMLElement {
  const line = shape("sk-line");
  // Through the CSSOM, which the staff app's policy allows where a style attribute isn't.
  if (width !== undefined) line.style.width = `${width}%`;
  return line;
}

/** A picture (`sk-avatar`, or `sk-thumb` for a square one) beside lines of these widths. */
function row(picture: string, ...widths: number[]): HTMLElement {
  return h(
    "div",
    { class: "sk-row" },
    shape(picture),
    h("div", { class: "sk-row-lines" }, ...widths.map(skLine)),
  );
}

/** `n` post placeholders: who wrote it, two lines of text, and a picture on every third. */
export function skeletonPosts(n = 3): HTMLElement[] {
  return times(n, (i) =>
    frame(
      "post",
      row("sk-avatar", 38),
      skLine(),
      skLine(width(i + 1)),
      i % 3 === 0 ? shape("sk-media") : null,
    ),
  );
}

/**
 * A card's placeholder: a short heading line and `lines` of text. `cls` adds the classes of the
 * card it stands in for, so it takes that card's place and size.
 */
export function skeletonCard(options: { lines?: number; cls?: string } = {}): HTMLElement {
  const { lines = 2, cls } = options;
  return frame(
    cls ? `card ${cls}` : "card",
    shape("sk-line sk-heading"),
    ...times(lines, (i) => skLine(width(i))),
  );
}

/** A list's placeholder: one card of `n` rows, each a picture, a name, and a line under it. */
function skeletonRows(n = 4): HTMLElement {
  return frame("card", ...times(n, (i) => row("sk-avatar", width(i) / 2, width(i + 2))));
}

/** `n` placeholders for a grid of cards with a picture each: plots to visit, galleries. */
export function skeletonTiles(n = 4): HTMLElement[] {
  return times(n, (i) => frame("card", row("sk-thumb", width(i) / 2, width(i + 1), width(i + 3))));
}

/** A profile header's placeholder: the banner, the picture over its edge, a name, and counts. */
function skeletonProfile(): HTMLElement {
  return frame(
    "card sk-profile",
    shape("sk-banner"),
    h(
      "div",
      { class: "sk-profile-body" },
      h("div", { class: "sk-profile-face" }, shape("sk-avatar")),
      h("div", { class: "sk-pills" }, shape("sk-button"), shape("sk-button")),
      shape("sk-title"),
      skLine(46),
      h("div", { class: "sk-pills" }, shape("sk-chip"), shape("sk-chip")),
      h("div", { class: "sk-pills sk-counts" }, ...times(4, () => shape("sk-count"))),
    ),
  );
}

/** What a page looks like while it loads. */
export interface PageShape {
  /**
   * The page's layout: a main column with a sidebar (`side`, or `side-last` when the sidebar
   * comes after the main column on a phone), cards the whole width (`wide`), or one `column`.
   */
  layout: "side" | "side-last" | "wide" | "column";
  /**
   * What the main column holds: posts, a list in one card, cards, a grid of cards with a picture
   * each, or one card.
   */
  main: "posts" | "rows" | "cards" | "grid" | "card";
  /** What sits over it: a page title unless said, a profile header, a card, or nothing. */
  head?: "title" | "profile" | "card" | "none";
}

const HEAD: Record<NonNullable<PageShape["head"]>, () => HTMLElement | null> = {
  title: () => shape("sk-title"),
  profile: skeletonProfile,
  card: () => skeletonCard({ lines: 4 }),
  none: () => null,
};

const MAIN: Record<PageShape["main"], () => HTMLElement[]> = {
  posts: () => skeletonPosts(2),
  rows: () => [skeletonRows()],
  cards: () => [skeletonCard({ lines: 3 }), skeletonCard()],
  grid: () => [h("div", { class: "card-grid" }, ...skeletonTiles())],
  card: () => [skeletonCard({ lines: 4 })],
};

/**
 * A whole page of placeholders in the layout the real page will have, so nothing moves when the
 * page takes its place. It says it's busy, and everything in it is hidden from screen readers.
 */
export function skeletonPage(page: PageShape): HTMLElement {
  const head = HEAD[page.head ?? "title"]();
  const main = MAIN[page.main]();
  if (page.layout === "column") {
    return h(
      "div",
      { class: "column stack cards page skeleton-page", attrs: { "aria-busy": "true" } },
      head,
      ...main,
    );
  }
  const sided =
    page.layout === "wide"
      ? undefined
      : pageLayout("skeleton-page", "Loading", { sideLast: page.layout === "side-last" });
  const layout = sided ?? wideLayout("skeleton-page");
  layout.el.setAttribute("aria-busy", "true");
  if (head) layout.head.append(head);
  layout.main.append(...main);
  if (sided) {
    sided.side.setAttribute("aria-hidden", "true");
    sided.side.append(skeletonCard({ lines: 3 }), skeletonCard());
  }
  return layout.el;
}
