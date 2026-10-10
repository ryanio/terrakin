/** What every feed page gives the router, plus a few shared page pieces. */
import { h, icon } from "@terrakin/ui/dom";
import { stateCard, whileBusy } from "@terrakin/ui/ui";
import type { Problem } from "./page-data";

export interface View {
  el: HTMLElement;
  /** Resolves once the first content is in, so the router can restore the scroll position. */
  ready: Promise<void>;
  destroy(): void;
}

export interface ViewContext {
  /** Arrived with back or forward: reuse cached data where we have it. */
  restoring: boolean;
  /** Unique per history entry. */
  key: string;
  setTitle(title: string): void;
  canGoBack(): boolean;
  /** Go to a page. `replace` swaps the current history entry, so Back skips it. */
  navigate(path: string, options?: { replace?: boolean }): void;
}

/** A friendly card for a page that doesn't exist. */
export function notFoundCard(
  heading = "We couldn't find that page",
  body = "It may have been deleted, or the link has a typo. The feed is a good place to start again.",
): HTMLElement {
  return stateCard({
    eyebrow: "Not found",
    level: "h1",
    titleId: "nf-title",
    title: heading,
    body,
    actions: [
      h(
        "a",
        { class: "pill-button", attrs: { href: "/" } },
        icon("feed"),
        h("span", { text: "Go to the feed" }),
      ),
    ],
  });
}

/**
 * A card for when a load fails, with a retry button. The button is busy while a `retry` that
 * returns its promise runs, so a tap shows it was taken.
 */
export function errorCard(message: string, retry: () => unknown): HTMLElement {
  const button = h("button", {
    class: "pill-button",
    attrs: { type: "button" },
    text: "Try again",
  });
  button.addEventListener("click", () => {
    const trying = retry();
    if (trying instanceof Promise) void whileBusy(button, () => trying);
  });
  return stateCard({
    role: "alert",
    title: "That didn't load",
    body: message,
    actions: [button],
  });
}

/**
 * Where a page's load problem goes, for `pageData`: the error card with Try again in `region`, or
 * `missing`'s card when the server says the thing isn't there.
 */
export function failInto(
  region: HTMLElement,
  missing?: () => HTMLElement,
): (problem: Problem, retry: () => Promise<void>) => void {
  return (problem, retry) =>
    region.replaceChildren(
      problem.missing && missing ? missing() : errorCard(problem.message, retry),
    );
}

/** Where a card for someone with no character sends them. */
const DOORS = {
  /** The get-started cards on the front page, as the top bar's Join does. */
  start: { href: "/#join", label: "Join" },
  world: { href: "/world", label: "Step into the world" },
} as const;

/** A card for a page that's only for residents: what they'd get here, and the way in. */
export function joinCard(o: {
  title: string;
  body: string;
  door: keyof typeof DOORS;
  eyebrow?: string;
  level?: "h1";
}): HTMLElement {
  const door = DOORS[o.door];
  return stateCard({
    ...(o.eyebrow ? { eyebrow: o.eyebrow } : {}),
    ...(o.level ? { level: o.level } : {}),
    title: o.title,
    body: o.body,
    actions: [
      h(
        "a",
        { class: "btn-primary", attrs: { href: door.href } },
        h("span", { text: door.label }),
        icon("arrow"),
      ),
    ],
  });
}

/** A card for a part of the world this server hasn't opened: `title` says which. */
export function notOpenCard(title: string): HTMLElement {
  return stateCard({ title, body: "Check back soon." });
}

/** A page with nothing to load and nothing to stop. */
export function staticView(el: HTMLElement): View {
  return { el, ready: Promise.resolve(), destroy() {} };
}

export function notFoundView(ctx: ViewContext): View {
  ctx.setTitle("Not found · Terrakin");
  return staticView(h("div", { class: "column stack cards page" }, notFoundCard()));
}
