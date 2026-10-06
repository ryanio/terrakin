/**
 * Live notices for the home wall: "Juniper just posted", "Wren moved in". They stack at the top of
 * the screen with a glowing border and a gradient on the names, then fade on their own. Names and
 * snippets are other residents' text, so they only go in as text nodes.
 */
import { h, icon } from "@terrakin/ui/dom";
import { avatarStack, type Person } from "@terrakin/ui/people";

export interface LiveNote {
  /** Who it's about, shown as stacked avatars. */
  people: readonly Person[];
  /** Set in gradient, for example the names. */
  lead: string;
  /** The rest of the line, for example "just posted". */
  rest: string;
  /** A line of their words, already shortened. */
  snippet?: string;
  tone: "post" | "join" | "home" | "town" | "coins";
  action?: { label: string; href?: string; run?: () => void };
}

const MAX = 3;
const SHOW_MS = 7_000;
const SPARKS = 8;

let stack: HTMLElement | undefined;

/**
 * The live region. Create it when the page mounts: screen readers often skip content that arrives
 * together with a new live region.
 */
export function liveToastHost(): HTMLElement {
  if (stack?.isConnected) return stack;
  stack = h("div", {
    class: "live-toasts",
    attrs: { role: "status", "aria-live": "polite", "aria-label": "What just happened" },
  });
  document.body.append(stack);
  return stack;
}

/** Shorten someone's words to one line for a notice. */
export function snippet(text: string, max = 90): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function liveToast(note: LiveNote): void {
  const root = liveToastHost();
  const avatars = avatarStack(note.people.slice(0, 3));
  const close = h(
    "button",
    {
      class: "lt-close",
      attrs: { type: "button", "aria-label": "Dismiss" },
      on: { click: () => dismiss() },
    },
    icon("close", "icon lt-close-icon"),
  );
  let go: HTMLElement | null = null;
  if (note.action?.href) {
    go = h("a", {
      class: "lt-go",
      attrs: { href: note.action.href },
      text: note.action.label,
      on: { click: () => dismiss() },
    });
  } else if (note.action?.run) {
    const run = note.action.run;
    go = h("button", {
      class: "lt-go",
      attrs: { type: "button" },
      text: note.action.label,
      on: {
        click: () => {
          run();
          dismiss();
        },
      },
    });
  }
  const sparks = h(
    "span",
    { class: "lt-sparks", attrs: { "aria-hidden": "true" } },
    ...Array.from({ length: SPARKS }, (_, i) => {
      const s = h("span", { class: "lt-spark" });
      s.style.setProperty("--a", `${(360 / SPARKS) * i + 12}deg`);
      s.style.setProperty("--d", `${36 + (i % 3) * 14}px`);
      return s;
    }),
  );
  // The glow sits under the card as an earlier sibling, so the card always paints over it.
  const el = h(
    "div",
    { class: `live-toast tone-${note.tone}` },
    h("span", { class: "lt-glow", attrs: { "aria-hidden": "true" } }),
    h(
      "div",
      { class: "lt-card" },
      sparks,
      avatars,
      h(
        "div",
        { class: "lt-body" },
        h(
          "p",
          { class: "lt-line" },
          h("span", { class: "lt-lead", text: note.lead }),
          ` ${note.rest}`,
        ),
        note.snippet ? h("p", { class: "lt-snippet", text: note.snippet }) : null,
      ),
      go,
      close,
    ),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, SHOW_MS);
  };
  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add("leaving");
    const remove = () => el.remove();
    el.addEventListener("animationend", remove, { once: true });
    // Reduced motion has no animation to end.
    setTimeout(remove, 400);
  }
  // Hold while someone is reading or reaching for it.
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", arm);
  el.addEventListener("focusin", () => clearTimeout(timer));
  el.addEventListener("focusout", arm);

  root.prepend(el);
  const live = [...root.querySelectorAll<HTMLElement>(".live-toast:not(.leaving)")];
  for (const old of live.slice(MAX)) old.remove();
  arm();
}

/** Clear every notice, for example when leaving the page. */
export function clearLiveToasts() {
  stack?.replaceChildren();
}
