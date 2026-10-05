/**
 * Shared page pieces for both apps: a toast, state cards, sheets and the overlay the back gesture
 * closes, checkbox rows, and copy-to-clipboard. Everything takes plain strings and sets them with
 * textContent.
 */
import { h, icon } from "./dom";

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short message at the bottom of the screen, with an optional link (for example "Join"). */
export function toast(text: string, link?: { href: string; label: string }) {
  const el = document.getElementById("site-toast");
  if (!el) return;
  el.replaceChildren(h("span", { text }));
  if (link)
    el.append(h("a", { class: "toast-link", text: link.label, attrs: { href: link.href } }));
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), link ? 4200 : 2600);
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
  opener: Element | null;
}

let current: Open | undefined;
let swallowNextPop = false;

function teardown(o: Open) {
  if (o.dialog.open) o.dialog.close();
  o.dialog.remove();
  document.documentElement.classList.remove("overlay-open");
  o.onClosed();
  if (o.opener instanceof HTMLElement) o.opener.focus({ preventScroll: true });
}

/**
 * Show a full-screen dialog. It closes with its close button, Escape, or the back gesture: we push
 * a history entry for it, so back pops the overlay instead of leaving the page.
 */
export function openOverlay(dialog: HTMLDialogElement, onClosed: () => void = () => {}) {
  if (current) closeOverlay();
  const opener = document.activeElement;
  document.body.append(dialog);
  dialog.showModal();
  document.documentElement.classList.add("overlay-open");
  history.pushState({ ...(history.state ?? {}), overlay: true }, "");
  current = { dialog, onClosed, opener };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeOverlay();
  });
}

export function closeOverlay() {
  const o = current;
  if (!o) return;
  current = undefined;
  teardown(o);
  if ((history.state as { overlay?: boolean } | null)?.overlay) {
    swallowNextPop = true;
    history.back();
  }
}

/** For the router: true when a popstate belonged to an overlay (and we handled it). */
export function interceptPop(): boolean {
  if (swallowNextPop) {
    swallowNextPop = false;
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
  /** A tap outside the card closes it. Leave off where closing would lose typing. */
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
      on: { click: () => closeOverlay() },
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
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeOverlay();
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

// ---------- copy ----------

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
