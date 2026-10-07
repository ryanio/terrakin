/**
 * Shared page pieces for both apps: a toast, state cards, sheets and the overlay the back gesture
 * closes, checkbox rows, and copy-to-clipboard. Everything takes plain strings and sets them with
 * textContent.
 */
import { xIntentUrl } from "@terrakin/protocol";
import { h, icon } from "./dom";
import type { Result } from "./http";
import { reducedMotion } from "./motion";

// ---------- page layout ----------

export interface PageLayout {
  el: HTMLElement;
  /** Over the main column: the page title, and anything that leads the page. */
  head: HTMLElement;
  main: HTMLElement;
  /** Beside the head and main from 1000px, between them on a phone. Hidden while empty. */
  side: HTMLElement;
}

/**
 * A page in the shared `.layout` (base.css): a head over the main column, and a sidebar for what
 * sits beside the page's main content (a balance, a form, a calendar, a ladder). `className` names
 * the page, like `shop-page`; `sideLabel` names the sidebar for screen readers. On a phone the
 * sidebar comes before the main column, or after it with `sideLast`, for a page whose main content
 * is what someone came for (a post, the town's proposals, open jobs).
 */
export function pageLayout(
  className: string,
  sideLabel: string,
  o: { sideLast?: boolean } = {},
): PageLayout {
  const head = h("div", { class: "layout-head" });
  const main = h("div", { class: "layout-main" });
  const side = h("aside", { class: "layout-side", attrs: { "aria-label": sideLabel } });
  const el = h(
    "div",
    { class: `cards page layout ${className}` },
    head,
    ...(o.sideLast ? [main, side] : [side, main]),
  );
  return { el, head, main, side };
}

/** A page in `.layout` with no sidebar, for a page of cards that wants the whole width. */
export function wideLayout(className: string): Omit<PageLayout, "side"> {
  const head = h("div", { class: "layout-head" });
  const main = h("div", { class: "layout-main" });
  const el = h("div", { class: `cards page layout ${className}` }, head, main);
  return { el, head, main };
}

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastHeld = false;
let toastFor = 0;
const toastWired = new WeakSet<HTMLElement>();

/**
 * How long a toast stays up: longer for longer words, and longer with a link, so someone on a
 * keyboard has time to reach it.
 */
export function toastMs(text: string, link = false): number {
  return Math.max(link ? 8000 : 4000, text.length * 60);
}

/**
 * A short message at the bottom of the screen, with an optional link (for example "Join"). It
 * waits while the pointer is on it or focus is in it.
 */
export function toast(text: string, link?: { href: string; label: string }) {
  const el = document.getElementById("site-toast");
  if (!el) return;
  el.replaceChildren(h("span", { text }));
  if (link)
    el.append(h("a", { class: "toast-link", text: link.label, attrs: { href: link.href } }));
  el.classList.add("show");
  if (!toastWired.has(el)) {
    toastWired.add(el);
    const hold = () => {
      toastHeld = true;
      clearTimeout(toastTimer);
    };
    const release = () => {
      // Still pointed at or focused: keep holding.
      if (el.matches(":hover, :focus-within")) return;
      toastHeld = false;
      if (el.classList.contains("show")) hideToastIn(el, toastFor);
    };
    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
  }
  toastFor = toastMs(text, Boolean(link));
  // Replacing a focused link sends no focusout, so ask again rather than trust the old hold.
  toastHeld = el.matches(":hover, :focus-within");
  if (!toastHeld) hideToastIn(el, toastFor);
}

function hideToastIn(el: HTMLElement, ms: number) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------- state card ----------

export interface StateCardOptions {
  title: string;
  body?: string;
  /** The small label above the title, like "Not found". */
  eyebrow?: string;
  /** `h1` when the card is the whole page. */
  level?: "h1" | "h2";
  titleId?: string;
  /** Added to `paper card state-card`. */
  className?: string;
  role?: "alert" | "status";
  actions?: readonly (HTMLElement | null)[];
}

/**
 * A centered card for a page's empty, error, or "join first" moment: a title, a line of text, and
 * its buttons or links.
 */
export function stateCard(o: StateCardOptions): HTMLElement {
  const actions = (o.actions ?? []).filter((a): a is HTMLElement => a !== null);
  return h(
    "section",
    {
      class: ["paper card state-card", o.className].filter(Boolean).join(" "),
      attrs: { role: o.role, "aria-labelledby": o.titleId },
    },
    o.eyebrow ? h("p", { class: "eyebrow", text: o.eyebrow }) : null,
    h(o.level ?? "h2", { class: "state-title", attrs: { id: o.titleId }, text: o.title }),
    o.body ? h("p", { class: "state-body", text: o.body }) : null,
    actions.length ? h("div", { class: "state-actions" }, ...actions) : null,
  );
}

/** A taped note for a list with nothing in it yet: what's missing, and how it fills up. */
export function emptyNote(title: string, body: string): HTMLElement {
  return h(
    "div",
    { class: "paper note empty-note" },
    h("h2", { text: title }),
    h("p", { text: body }),
  );
}

/** The line under a form that says what went wrong, read out when it changes. */
export function errorLine(id?: string): HTMLParagraphElement {
  return h("p", { class: "form-error", attrs: { id, role: "alert" } });
}

// ---------- item rows ----------

export interface ItemRowOptions {
  /** A picture or mark before the text, about 32px: `itemArt`, an avatar, a coin. */
  lead?: Node | null;
  name: string;
  /** Lines under the name in the soft color, each held to two lines. */
  lines?: readonly (string | Node | null)[];
  /** One thing after the text: an amount or a button. */
  trail?: Node | null;
  /** No frame of its own, for rows inside a sheet or card. */
  plain?: boolean;
  /** Added to `item-row`, so a view can still find and color its rows. */
  className?: string;
  attrs?: Record<string, string>;
}

/**
 * One line in a list of things: a picture, a name with a line or two under it, and an amount or a
 * button at the end. The purse's ledger, your things, the shop's buy orders and a workshop's
 * choices are all these. Put them in `itemRows`.
 */
export function itemRow(o: ItemRowOptions): HTMLLIElement {
  return h(
    "li",
    {
      class: ["item-row", o.plain ? "plain" : "", o.className].filter(Boolean).join(" "),
      attrs: o.attrs ?? {},
    },
    o.lead ?? null,
    h(
      "span",
      { class: "item-row-body" },
      h("span", { class: "item-row-name", text: o.name }),
      ...(o.lines ?? []).map((line) =>
        line === null ? null : h("span", { class: "item-row-line" }, line),
      ),
    ),
    o.trail ?? null,
  );
}

/** The list `itemRow`s go in. `ordered` for a list whose order means something, like a ledger. */
export function itemRows(
  rows: readonly HTMLLIElement[],
  o: { ordered?: boolean; className?: string } = {},
): HTMLOListElement | HTMLUListElement {
  const className = ["stack tight plain-list item-rows", o.className].filter(Boolean).join(" ");
  return o.ordered
    ? h("ol", { class: className }, ...rows)
    : h("ul", { class: className }, ...rows);
}

// ---------- progress bar ----------

/**
 * A thin moss bar for how far along something is: `count` of `total`, read out as `label` ("12 of
 * 40 collected"). The fill's width is a custom property, since the page's CSP refuses inline styles.
 */
export function progressBar(count: number, total: number, label: string): HTMLDivElement {
  const bar = h(
    "div",
    {
      class: "progress-bar",
      attrs: {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": "0",
        "aria-valuemax": String(total),
        "aria-valuenow": String(count),
      },
    },
    h("span", { class: "progress-bar-fill" }),
  );
  bar.style.setProperty("--done", `${total > 0 ? Math.round((count / total) * 100) : 0}%`);
  return bar;
}

// ---------- kind pill ----------

/** A kind pill's colors: moss (green) or sun (warm, with clay text). Each view picks one. */
export type PillTone = "moss" | "sun";

/**
 * A small rounded label saying what kind of thing a card or row is: a proposal's kind, who put up
 * a bounty, a shop item's season. It shows `text` as written, so copy that quotes a pill matches
 * it. `className` is added to `kind-pill`, so a view can still find it.
 */
export function kindPill(text: string, tone: PillTone, className?: string): HTMLSpanElement {
  return h("span", { class: ["kind-pill", tone, className].filter(Boolean).join(" "), text });
}

// ---------- link tabs ----------

/** One tab in a `linkTabs` row: a sibling page, or with `pick`, a panel on this page. */
export interface LinkTab {
  /** The sibling page it opens. A panel tab has none. */
  href?: string;
  /** The page you're on, or the panel that's showing. */
  current: boolean;
  /** What the tab shows: a label, or a count and a label. */
  content: readonly (string | Node)[];
  /** A panel tab's id, which its panel names in `aria-labelledby`. */
  id?: string;
  /** The id of the panel a panel tab shows (`aria-controls`). */
  panel?: string;
}

export interface LinkTabsOptions {
  /** What the row is, for screen readers. */
  label: string;
  /** Added to `link-tabs`. */
  className?: string;
  /** Added to each `link-tab`. */
  tabClass?: string;
  /** Links: a tap swaps the page in place (the router's navigate, say). */
  go?: (href: string) => void;
  /** Panel tabs: called with a tab's index once a tap or an arrow key has picked it. */
  pick?: (index: number) => void;
}

/**
 * A switch between sibling pages, or with `pick`, between panels on one page, the current one
 * raised on paper.
 *
 * Pages (plots and galleries, someone's followers, following, and friends) are links, the current
 * one `aria-current="page"`. With `go`, a tap swaps the page in place; a modified click opens a new
 * browser tab, as a link does.
 *
 * Panels (the feed's Everyone and Following, the build bar's kinds) are buttons in a tablist, the
 * current one `aria-selected`. Only it is in the tab order, and the arrow keys, Home, and End pick
 * another. `pickTab` marks one from outside the row. `className` and `tabClass` are added to
 * `link-tabs` and `link-tab`.
 */
export function linkTabs(tabs: readonly LinkTab[], o: LinkTabsOptions): HTMLElement {
  const className = ["link-tabs", o.className].filter(Boolean).join(" ");
  const tabClass = ["link-tab", o.tabClass].filter(Boolean).join(" ");
  const { pick } = o;
  if (!pick) {
    return h(
      "nav",
      { class: className, attrs: { "aria-label": o.label } },
      ...tabs.map((t) =>
        h(
          "a",
          {
            class: tabClass,
            attrs: { href: t.href, "aria-current": t.current ? "page" : null },
            on: {
              click: (e) => {
                if (!o.go || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                if (!t.current && t.href) o.go(t.href);
              },
            },
          },
          ...t.content,
        ),
      ),
    );
  }
  function choose(i: number, focus: boolean) {
    pickTab(row, i, { focus });
    pick?.(i);
  }
  const buttons = tabs.map((t, i) =>
    h(
      "button",
      {
        class: tabClass,
        attrs: { type: "button", role: "tab", id: t.id, "aria-controls": t.panel },
        on: { click: () => choose(i, false) },
      },
      ...t.content,
    ),
  );
  const row = h(
    "div",
    {
      class: className,
      attrs: { role: "tablist", "aria-label": o.label },
      on: {
        keydown: (e) => {
          const at = buttons.findIndex((b) => b.tabIndex === 0);
          const last = buttons.length - 1;
          const next =
            e.key === "ArrowRight"
              ? (at + 1) % buttons.length
              : e.key === "ArrowLeft"
                ? (at + last) % buttons.length
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? last
                    : -1;
          if (next < 0) return;
          e.preventDefault();
          choose(next, true);
        },
      },
    },
    ...buttons,
  );
  pickTab(
    row,
    tabs.findIndex((t) => t.current),
  );
  return row;
}

/**
 * Mark panel tab `index` of a `linkTabs` row as the one showing, without calling `pick`: for a
 * switch made outside the row, like the feed's "See everyone's posts". `focus` moves focus to it.
 */
export function pickTab(row: HTMLElement, index: number, o: { focus?: boolean } = {}): void {
  const tabs = row.querySelectorAll<HTMLElement>(":scope > [role=tab]");
  const at = index >= 0 && index < tabs.length ? index : 0;
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === at));
    tab.tabIndex = i === at ? 0 : -1;
  });
  if (o.focus) tabs[at]?.focus();
}

// ---------- chips ----------

/**
 * A row of pressable chips where one is picked, like colors or shapes. Fills `row` when given (a
 * row already in the page), else makes one. Each chip carries `data-value`, and the class
 * `classFor` gives its value, if any.
 */
export function chips<T extends string>(
  options: readonly T[],
  first: T,
  draw: (value: T) => Node[],
  onPick: (value: T) => void = () => {},
  row: HTMLElement = h("div", { class: "swatch-row" }),
  classFor?: (value: T) => string | undefined,
): { row: HTMLElement; value: () => T } {
  let chosen = first;
  row.setAttribute("role", "group");
  for (const value of options) {
    const b = h(
      "button",
      {
        class: classFor?.(value),
        attrs: { type: "button", "aria-pressed": String(value === first), "data-value": value },
        on: {
          click: () => {
            chosen = value;
            for (const other of row.children) {
              other.setAttribute("aria-pressed", String(other === b));
            }
            onPick(value);
          },
        },
      },
      ...draw(value),
    );
    row.append(b);
  }
  return { row, value: () => chosen };
}

// ---------- busy buttons ----------

/**
 * Disabling a focused button drops keyboard focus to the page. Call this before disabling it, and
 * the returned function (called once it's enabled again) puts focus back, unless something else
 * took focus meanwhile.
 */
export function holdFocus(button: HTMLElement): () => void {
  const had = document.activeElement === button;
  return () => {
    const now = document.activeElement;
    if (had && button.isConnected && (now === null || now === document.body))
      button.focus({ preventScroll: true });
  };
}

/**
 * Run `work` with `button` disabled and marked busy, so a second tap can't send it twice. With
 * `busyText`, `label` (the button itself unless given) says it until the work settles.
 */
export async function whileBusy<T>(
  button: HTMLButtonElement,
  work: () => Promise<T>,
  busyText?: string,
  label: HTMLElement = button,
): Promise<T> {
  const idle = label.textContent;
  const refocus = holdFocus(button);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (busyText) label.textContent = busyText;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (busyText) label.textContent = idle;
    refocus();
  }
}

/**
 * Run `work` with every button in a group off and `status` saying "Saving…", for a card whose
 * buttons all act on one thing. If it fails, the buttons come back on, `status` says why, and focus
 * goes back to `pressed`. If it works they stay off, so a second tap can't send it again.
 */
export async function whileBusyAll<T>(
  buttons: readonly HTMLButtonElement[],
  pressed: HTMLButtonElement,
  status: HTMLElement,
  work: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const refocus = holdFocus(pressed);
  for (const b of buttons) b.disabled = true;
  status.textContent = "Saving…";
  const res = await work();
  if (!res.ok) {
    for (const b of buttons) b.disabled = false;
    status.textContent = res.message;
    refocus();
  }
  return res;
}

// ---------- show more ----------

/**
 * "Show more" at the foot of a list. Starts hidden: the caller shows it while there is another
 * page. `next` loads that page and returns a problem when it couldn't; the button then offers to
 * try again. `run` does the same as a tap, for paging on scroll.
 */
export function moreButton(label: string, next: () => Promise<string | undefined>) {
  const el = h("button", {
    class: "pill-button load-more",
    attrs: { type: "button", hidden: true },
    text: label,
  });
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    const refocus = holdFocus(el);
    el.disabled = true;
    el.textContent = "Loading…";
    const problem = await next();
    busy = false;
    el.disabled = false;
    el.textContent = problem ? "Couldn't load more. Try again" : label;
    // Hidden at the end of the list: focus stays with the page then.
    if (!el.hidden) refocus();
  };
  el.addEventListener("click", () => void run());
  return { el, run };
}

// ---------- checkbox and radio rows ----------

export interface CheckRowOptions {
  id: string;
  label: string;
  hint?: string | null;
  checked?: boolean;
  /** A radio row in a group; the default is a checkbox. */
  radio?: { name: string; value: string };
}

/** A labeled checkbox or radio with a hint line and a 44px tap target. */
export function checkRow(o: CheckRowOptions) {
  const input = h("input", {
    class: "check-input",
    attrs: {
      type: o.radio ? "radio" : "checkbox",
      id: o.id,
      name: o.radio?.name,
      value: o.radio?.value,
      checked: o.checked,
    },
  });
  const el = h(
    "label",
    { class: "check-row", attrs: { for: o.id } },
    input,
    h(
      "span",
      { class: "check-text" },
      h("span", { class: "check-label", text: o.label }),
      o.hint ? h("span", { class: "check-hint", text: o.hint }) : null,
    ),
  );
  return { el, input };
}

// ---------- overlay ----------

interface Open {
  dialog: HTMLDialogElement;
  onClosed: () => void;
  /** Where focus goes when it closes, in order: the first one still on screen. */
  focusBack: (Element | null | undefined)[];
}

let current: Open | undefined;
let swallowNextPop = false;
/** The open overlay has no history entry yet: it opened while a step back was on its way. */
let entryOwed = false;

const onOverlayEntry = () => Boolean((history.state as { overlay?: boolean } | null)?.overlay);
const pushOverlayEntry = () => history.pushState({ ...(history.state ?? {}), overlay: true }, "");

/** On the page and drawn: a menu item in a closed menu isn't, so focus can't go back to it. */
const onScreen = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;

/**
 * Close `o`. Its state goes at once, so `onClosed` and the next overlay never wait; with `animate`,
 * the dialog plays its closing animation (`.closing` in base.css) before it leaves the page.
 */
function teardown(o: Open, { refocus = true, animate = false } = {}) {
  o.onClosed();
  const gone = () => {
    // Opened again while it animated out: it stays.
    if (current?.dialog === o.dialog) return;
    o.dialog.classList.remove("closing");
    if (o.dialog.open) o.dialog.close();
    o.dialog.remove();
    // Another overlay opened while this one animated out: the page stays locked, focus stays there.
    if (current) return;
    document.documentElement.classList.remove("overlay-open");
    if (refocus) o.focusBack.find(onScreen)?.focus({ preventScroll: true });
  };
  if (animate) playOut(o.dialog, gone);
  else gone();
}

/** Play `dialog`'s closing animation, then `done`. None in its styles, or reduced motion: now. */
function playOut(dialog: HTMLDialogElement, done: () => void) {
  if (reducedMotion()) return done();
  dialog.classList.add("closing");
  const running = dialog.getAnimations({ subtree: true });
  if (!running.length) return done();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done();
  };
  // A hidden tab can hold an animation's end back, so a timer backs it up.
  const timer = setTimeout(finish, 500);
  void Promise.allSettled(running.map((a) => a.finished)).then(finish);
}

/**
 * Show a full-screen dialog. It closes with its close button, Escape, or the back gesture: we push
 * a history entry for it, so back pops the overlay instead of leaving the page. Closing puts focus
 * back on whatever had it, or on `returnTo` when given (say, the "…" button whose menu item opened
 * it, since the item is gone once the menu closes).
 */
export function openOverlay(
  dialog: HTMLDialogElement,
  onClosed: () => void = () => {},
  returnTo?: HTMLElement,
) {
  const prev = current;
  const focusBack = [returnTo, document.activeElement];
  if (prev) {
    // One overlay replaces another in the same history entry. Going back and pushing in the same
    // tick races, and the browser can drop the new entry.
    current = undefined;
    teardown(prev, { refocus: false });
    focusBack.push(...prev.focusBack);
  }
  dialog.classList.remove("closing");
  document.body.append(dialog);
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add("overlay-open");
  current = { dialog, onClosed, focusBack };
  // A step back still on its way: push once it lands (interceptPop), never in the same tick.
  if (swallowNextPop) entryOwed = true;
  else if (!(prev && onOverlayEntry())) pushOverlayEntry();
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeOverlay(dialog);
  });
}

/** True while `dialog` is the overlay on screen. */
export function overlayShowing(dialog: HTMLDialogElement): boolean {
  return current?.dialog === dialog;
}

/**
 * Close the overlay on top, or only `dialog` when given, so a sheet finishing after an await
 * can't close one opened since. With `leaving`, the page is about to change: the overlay goes
 * without stepping back, and the router replaces its history entry (see `leaveOverlay`).
 */
export function closeOverlay(dialog?: HTMLDialogElement, o: { leaving?: boolean } = {}) {
  const open = current;
  if (!open || (dialog && open.dialog !== dialog)) return;
  current = undefined;
  // Leaving for another page: it goes at once, since the page under it is about to change.
  teardown(open, { refocus: !o.leaving, animate: !o.leaving });
  if (entryOwed) {
    // It never got an entry, so there is nothing to step back from.
    entryOwed = false;
    return;
  }
  if (!o.leaving && onOverlayEntry()) {
    swallowNextPop = true;
    history.back();
  }
}

/**
 * For the router, just before it goes to another page: closes any overlay without stepping back,
 * and says whether this history entry is an overlay's. The router then replaces that entry with
 * the new page instead of pushing after it. Stepping back and pushing in the same tick races, and
 * the browser can drop the pushed entry, leaving the new page under the old URL.
 */
export function leaveOverlay(): boolean {
  closeOverlay(undefined, { leaving: true });
  return !swallowNextPop && onOverlayEntry();
}

/** For the router: true when a popstate belonged to an overlay (and we handled it). */
export function interceptPop(): boolean {
  if (swallowNextPop) {
    swallowNextPop = false;
    if (entryOwed && current) pushOverlayEntry();
    entryOwed = false;
    return true;
  }
  const o = current;
  if (!o) return false;
  current = undefined;
  teardown(o, { animate: true });
  return true;
}

// ---------- close ----------

/**
 * A round button with an X, named by `label` for screen readers: a sheet's close, or putting away
 * a card on the home wall (`cardBar`). `className` is added to `sheet-close`.
 */
export function closeButton(
  label: string,
  onClose: () => void,
  className?: string,
): HTMLButtonElement {
  return h(
    "button",
    {
      class: ["sheet-close", className].filter(Boolean).join(" "),
      attrs: { type: "button", "aria-label": label },
      on: { click: onClose },
    },
    icon("close"),
  );
}

/**
 * The top line of a card someone can put away: what it is, small, and a `closeButton` at the end.
 * The devlog card and the Getting started card on the home wall have one.
 */
export function cardBar(eyebrow: string, close: HTMLButtonElement): HTMLElement {
  return h("div", { class: "card-bar" }, h("p", { class: "eyebrow", text: eyebrow }), close);
}

// ---------- sheet ----------

export interface SheetOptions {
  /** The title's id; the dialog is labelled by it. */
  id: string;
  title: string;
  /** Added to `sheet`, like `invite-sheet`. */
  className?: string;
  /** A line of plain words under the title. */
  lede?: string;
  /** A tap outside the card closes it, until something is typed in one of its fields. */
  closeOnBackdrop?: boolean;
}

/** Wide enough for a sheet to be a centered card. Narrower, it's a bottom sheet (base.css). */
const SHEET_AS_CARD = "(min-width: 640px)";

/**
 * A sheet: a bottom sheet on a phone, which a pull down on it closes, and a centered card on a wide
 * screen. Show it with `openOverlay(sheet.dialog)`; the close button, Escape, and the back gesture
 * close it too, and it slides away as it goes.
 */
export function sheet(o: SheetOptions, ...body: (Node | null)[]) {
  const close = closeButton("Close", () => closeOverlay(dialog));
  const title = h("h2", { class: "sheet-title", attrs: { id: o.id }, text: o.title });
  // Focusable, so a sheet whose buttons are all choices can open with focus on itself: focus on a
  // button draws the ring around it in Safari, and it looks picked before anyone has chosen.
  const card = h(
    "div",
    { class: "sheet-card paper", attrs: { tabindex: -1 } },
    h("div", { class: "sheet-head" }, title, close),
    o.lede ? h("p", { class: "sheet-lede", text: o.lede }) : null,
    ...body,
  );
  const dialog = h(
    "dialog",
    {
      class: ["sheet", o.className].filter(Boolean).join(" "),
      attrs: { "aria-labelledby": o.id },
    },
    card,
  );
  // Something typed in one of its fields: a stray tap outside or a pull down never throws it away.
  const typed = () =>
    [...dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some(
      (f) => f.value !== f.defaultValue,
    );
  if (o.closeOnBackdrop) {
    // Only a tap that starts and ends outside the card: a drag that selects text in a field and
    // lets go outside is not a tap out.
    let downOutside = false;
    dialog.addEventListener("pointerdown", (e) => {
      downOutside = e.target === dialog;
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog && downOutside && !typed()) closeOverlay(dialog);
    });
  }
  pullToClose(dialog, card, typed);
  return { dialog, title, close, card };
}

/**
 * On a phone, a pull down that starts while the card is scrolled to the top drags the card with the
 * finger. Let go far enough or fast enough and it closes; short of that, or with something typed, it
 * springs back. Touch events, so the pull can claim the gesture (preventDefault) once it is clearly
 * a pull, and leave a scroll, a sideways swipe, or a scrolled list inside the card alone.
 */
function pullToClose(dialog: HTMLDialogElement, card: HTMLElement, typed: () => boolean) {
  const asCard = matchMedia(SHEET_AS_CARD);
  let from: { x: number; y: number; t: number } | undefined;
  let pulling = false;
  let dy = 0;
  card.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      from = undefined;
      if (!t || e.touches.length !== 1 || asCard.matches || !overlayShowing(dialog)) return;
      if (scrolledWithin(e.target, card)) return;
      from = { x: t.clientX, y: t.clientY, t: performance.now() };
      pulling = false;
      dy = 0;
    },
    { passive: true },
  );
  card.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (!from || !t) return;
      dy = Math.max(0, t.clientY - from.y);
      if (!pulling) {
        const dx = Math.abs(t.clientX - from.x);
        const up = t.clientY < from.y;
        if (!up && dy === 0 && dx === 0) return;
        // Up, more sideways than down, or a scroll the browser already began: not a pull.
        if (up || dx > dy || !e.cancelable) {
          from = undefined;
          return;
        }
        pulling = true;
        card.classList.add("pulling");
      }
      e.preventDefault();
      card.style.translate = `0 ${dy}px`;
    },
    { passive: false },
  );
  const release = () => {
    if (!from) return;
    const ms = performance.now() - from.t;
    from = undefined;
    if (!pulling) return;
    pulling = false;
    card.classList.remove("pulling");
    const flick = dy / Math.max(1, ms) > 0.6 && dy > 30;
    const far = dy > Math.min(140, card.offsetHeight * 0.25);
    // Closing slides it on from where the finger left it; the closing animation adds to `translate`.
    if ((far || flick) && !typed()) closeOverlay(dialog);
    else card.style.translate = "";
  };
  card.addEventListener("touchend", release);
  card.addEventListener("touchcancel", release);
  dialog.addEventListener("close", () => {
    card.style.translate = "";
  });
}

/** True when `target`, or something between it and `card`, is scrolled down from its top. */
function scrolledWithin(target: EventTarget | null, card: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === card) return false;
  }
  return false;
}

// ---------- small popover ----------

let openPop: { el: HTMLElement; close(): void } | undefined;

/**
 * Show a small menu inside `host` (which is position: relative). It closes on a tap outside, on
 * Escape (focus goes back to `opener`), or when the caller calls the returned function. One at a
 * time: opening another closes this one.
 */
export function openPopover(host: HTMLElement, el: HTMLElement, opener: HTMLElement): () => void {
  openPop?.close();
  host.append(el);
  opener.setAttribute("aria-expanded", "true");
  const onDown = (e: PointerEvent) => {
    if (e.target instanceof Node && (el.contains(e.target) || opener.contains(e.target))) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    close();
    opener.focus({ preventScroll: true });
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    opener.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    if (openPop?.el === el) openPop = undefined;
  }
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  openPop = { el, close };
  el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  return close;
}

// ---------- confirm twice ----------

/**
 * A button for something hard to undo: the first tap changes its label to `again`, the second runs
 * `act`. `ask` says whether this tap needs asking at all (unblocking doesn't). Returns `disarm`,
 * which puts the label back, for example when its menu closes.
 */
export function confirmTwice(
  button: HTMLButtonElement,
  again: string,
  act: () => unknown,
  ask: () => boolean = () => true,
): () => void {
  let idle: string | null = null;
  const disarm = () => {
    if (idle === null) return;
    button.textContent = idle;
    idle = null;
  };
  button.addEventListener("click", () => {
    if (idle === null && ask()) {
      idle = button.textContent ?? "";
      button.textContent = again;
      return;
    }
    disarm();
    void act();
  });
  return disarm;
}

// ---------- "More" menu ----------

export interface MoreMenuOptions {
  /** The menu's id, for `aria-controls`. Unique on the page. */
  id: string;
  /** Buttons, or links for items that go somewhere. */
  items: HTMLElement[];
  /** Classes for the "…" button. */
  buttonClass?: string;
  /** Added to the `more` wrapper. */
  className?: string;
  /** Runs each time the menu closes, for example to reset a "tap again" item. */
  onClose?: () => void;
}

/**
 * Make `button` open and close `panel`, a small menu or popover inside `container`. It closes on a
 * tap outside `container`, on Escape (focus goes back to the button), or when the caller calls
 * `close` (focus goes back to the button if it was in the panel, which is about to vanish). The
 * listeners only exist while it's open.
 */
export function dropdown(
  button: HTMLElement,
  panel: HTMLElement,
  container: HTMLElement,
  onClose?: () => void,
) {
  const onDown = (e: PointerEvent) => {
    if (!(e.target instanceof Node && container.contains(e.target))) setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setOpen(false);
    button.focus({ preventScroll: true });
  };
  function setOpen(open: boolean) {
    if (open === !panel.hidden) return;
    if (!open && panel.contains(document.activeElement)) button.focus({ preventScroll: true });
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      return;
    }
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    onClose?.();
  }
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => setOpen(Boolean(panel.hidden)));
  return { close: () => setOpen(false) };
}

/** A "…" button with a small menu under it, built on `dropdown`. An item calls `close` after it acts. */
export function moreMenu(o: MoreMenuOptions) {
  const button = h(
    "button",
    {
      class: o.buttonClass ?? "pill-button small more-button",
      attrs: {
        type: "button",
        "aria-label": "More",
        "aria-haspopup": "true",
        "aria-controls": o.id,
      },
    },
    icon("more"),
  );
  const menu = h("div", { class: "paper menu", attrs: { id: o.id, hidden: true } }, ...o.items);
  const el = h("div", { class: ["more", o.className].filter(Boolean).join(" ") }, button, menu);
  const { close } = dropdown(button, menu, el, o.onClose);
  return { el, close };
}

// ---------- disclosure ----------

/**
 * A button that shows and hides `panel` (a small form under it), with `aria-expanded` kept in step.
 * Opening focuses `focus`, usually the panel's first field. `onToggle` runs after each change, for
 * example to relabel the button. `close` hides it, for example after the form sends.
 */
export function disclosure(
  button: HTMLButtonElement,
  panel: HTMLElement,
  focus?: HTMLElement,
  onToggle?: (open: boolean) => void,
) {
  if (panel.id) button.setAttribute("aria-controls", panel.id);
  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) focus?.focus();
    onToggle?.(open);
  };
  button.setAttribute("aria-expanded", String(!panel.hidden));
  button.addEventListener("click", () => set(Boolean(panel.hidden)));
  return { close: () => set(false) };
}

// ---------- copy ----------

/** How long a copy button says "Copied" before it goes back. */
const COPIED_MS = 2600;

let announcer: HTMLElement | undefined;

/**
 * Say `text` to screen readers without showing it, for a result that only changes a label. The
 * live region sits in `near`'s dialog when it has one, since an open modal hides the rest of the
 * page from them.
 */
export function announce(text: string, near?: Element) {
  const host = near?.closest("dialog") ?? document.body;
  if (announcer?.parentElement !== host) {
    announcer?.remove();
    announcer = h("p", { class: "visually-hidden", attrs: { role: "status" } });
    host.append(announcer);
  }
  const el = announcer;
  el.textContent = "";
  // A live region reads what changes in it, so the words go in a moment after it's ready.
  setTimeout(() => {
    el.textContent = text;
  }, 100);
}

export interface CopyButtonOptions {
  /** The label at rest, like "Copy" or "Copy link". */
  idle: string;
  copied?: string;
  /** Shown when the clipboard refused and `fallback` got selected instead. */
  selected?: string;
  /** Selected when the clipboard refuses, so a long-press copy works. */
  fallback?: Element;
  /** The toast when the clipboard refuses and there is nothing on the page to select. */
  failed?: string;
  /** After each try, and again with `null` when the label goes back to `idle`. */
  onChange?: (state: "copied" | "selected" | "failed" | null) => void;
}

/**
 * Make `button` copy `text()` when tapped and say so on `label` for a moment. Every copy button
 * in both apps goes through here, so they all answer the same way.
 */
export function copyButton(
  button: HTMLButtonElement,
  label: HTMLElement,
  text: () => string,
  o: CopyButtonOptions,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    const ok = await copyText(text(), o.fallback);
    const state = ok ? "copied" : o.fallback ? "selected" : "failed";
    if (state === "failed") toast(o.failed ?? "Couldn't copy. Press and hold the text to copy it.");
    label.textContent =
      state === "copied"
        ? (o.copied ?? "Copied")
        : state === "selected"
          ? (o.selected ?? "Selected")
          : o.idle;
    o.onChange?.(state);
    // A changed label isn't read out, so say it. A failure already said so in the toast.
    if (state !== "failed") announce(label.textContent ?? "", button);
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = o.idle;
      o.onChange?.(null);
    }, COPIED_MS);
  });
}

/**
 * A line to copy, with a caption and a Copy button. The text sits in one paragraph with no hard
 * breaks, so it wraps on screen and copies as one line.
 */
export function copyBlock(caption: string, text: string, className = ""): HTMLElement {
  const body = h("p", { class: "copy-text", text });
  const label = h("span", { text: "Copy" });
  // The caption is in the button's name as hidden words, not an aria-label, so the name follows
  // the label when it says "Copied".
  const button = h(
    "button",
    { class: "pill-button small copy-button", attrs: { type: "button" } },
    icon("copy"),
    label,
    h("span", { class: "visually-hidden", text: `: ${caption}` }),
  );
  copyButton(button, label, () => body.textContent ?? text, { idle: "Copy", fallback: body });
  return h(
    "figure",
    { class: ["copy-line", className].filter(Boolean).join(" ") },
    h("figcaption", { class: "copy-caption", text: caption }),
    body,
    button,
  );
}

/** Copy text, or select `fallback` so a long-press copy works. Returns true when it copied. */
export async function copyText(text: string, fallback?: Element): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return false;
  }
}

/** Share a page of ours: the system share sheet when there is one, else copy the link. */
export async function shareLink(path: string, title: string) {
  const url = new URL(path, location.origin).href;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, title });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  toast((await copyText(url)) ? "Link copied" : "Couldn't copy the link");
}

export interface ShareOnXOptions {
  /** The words the post starts with. The page's link goes after them. */
  text: string;
  /** A page of ours, as a path. */
  path: string;
  /** A picture to go with the post. */
  picture?: File;
  className?: string;
}

/**
 * "Share on X": a link to X's post box with the words and the link filled in. X's link can't carry a
 * picture, so with one, a phone hands it to its share sheet, where X takes the picture and the words
 * together; anywhere else the picture is copied as the link opens, to paste into the post.
 */
export function shareOnX(o: ShareOnXOptions): HTMLAnchorElement {
  const words = `${o.text} ${new URL(o.path, location.origin).href}`;
  const link = h(
    "a",
    {
      class: ["pill-button small", o.className].filter(Boolean).join(" "),
      attrs: { href: xIntentUrl(words), target: "_blank", rel: "noopener noreferrer" },
    },
    h("span", { text: "Share on X" }),
  );
  const { picture } = o;
  if (!picture) return link;
  link.addEventListener("click", (e) => {
    const files = [picture];
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files })) {
      e.preventDefault();
      navigator.share({ files, text: words }).catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          toast("Couldn't open the share sheet. Save the picture and add it to a post on X.");
        }
      });
      return;
    }
    // Now, before X's tab opens: a page that has lost focus can't write to the clipboard.
    if (typeof ClipboardItem !== "function" || !navigator.clipboard?.write) return;
    navigator.clipboard
      .write([new ClipboardItem({ [picture.type]: picture })])
      .then(() => toast("Picture copied. Paste it into your post on X."))
      .catch(() => {});
  });
  return link;
}
