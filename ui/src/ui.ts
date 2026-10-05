/**
 * Shared page pieces for both apps: a toast, state cards, sheets and the overlay the back gesture
 * closes, checkbox rows, and copy-to-clipboard. Everything takes plain strings and sets them with
 * textContent.
 */
import { h, icon } from "./dom";

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

// ---------- chips ----------

/**
 * A row of pressable chips where one is picked, like colors or shapes. Fills `row` when given (a
 * row already in the page), else makes one. Each chip carries `data-value`.
 */
export function chips<T extends string>(
  options: readonly T[],
  first: T,
  draw: (value: T) => Node[],
  onPick: (value: T) => void = () => {},
  row: HTMLElement = h("div", { class: "swatch-row" }),
): { row: HTMLElement; value: () => T } {
  let chosen = first;
  row.setAttribute("role", "group");
  for (const value of options) {
    const b = h(
      "button",
      {
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

function teardown(o: Open, refocus = true) {
  if (o.dialog.open) o.dialog.close();
  o.dialog.remove();
  document.documentElement.classList.remove("overlay-open");
  o.onClosed();
  if (refocus) o.focusBack.find(onScreen)?.focus({ preventScroll: true });
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
    teardown(prev, false);
    focusBack.push(...prev.focusBack);
  }
  document.body.append(dialog);
  dialog.showModal();
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
  teardown(open, !o.leaving);
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
  teardown(o);
  return true;
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

/**
 * A sheet: rises from the bottom on a phone, a centered card on a wide screen. Show it with
 * `openOverlay(sheet.dialog)`; the close button and the back gesture both close it.
 */
export function sheet(o: SheetOptions, ...body: (Node | null)[]) {
  const close = h(
    "button",
    {
      class: "sheet-close",
      attrs: { type: "button", "aria-label": "Close" },
      on: { click: () => closeOverlay(dialog) },
    },
    icon("close"),
  );
  const title = h("h2", { class: "sheet-title", attrs: { id: o.id }, text: o.title });
  const dialog = h(
    "dialog",
    {
      class: ["sheet", o.className].filter(Boolean).join(" "),
      attrs: { "aria-labelledby": o.id },
    },
    h(
      "div",
      { class: "sheet-card paper" },
      h("div", { class: "sheet-head" }, title, close),
      o.lede ? h("p", { class: "sheet-lede", text: o.lede }) : null,
      ...body,
    ),
  );
  if (o.closeOnBackdrop) {
    // Only a tap that starts and ends outside the card: a drag that selects text in a field and
    // lets go outside is not a tap out. And never once something is typed, so nothing is lost.
    let downOutside = false;
    dialog.addEventListener("pointerdown", (e) => {
      downOutside = e.target === dialog;
    });
    const typed = () =>
      [...dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some(
        (f) => f.value !== f.defaultValue,
      );
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog && downOutside && !typed()) closeOverlay(dialog);
    });
  }
  return { dialog, title, close };
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
  items: HTMLButtonElement[];
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
