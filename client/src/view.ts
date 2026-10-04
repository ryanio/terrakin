/** What every feed page gives the router, plus a few shared page pieces. */
import { h, icon } from "./dom";

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
  navigate(path: string): void;
}

/** A friendly card for a page that doesn't exist. */
export function notFoundCard(
  heading = "We couldn't find that page",
  body = "It may have been deleted, or the link has a typo. The feed is a good place to start again.",
): HTMLElement {
  return h(
    "section",
    { class: "paper card state-card", attrs: { "aria-labelledby": "nf-title" } },
    h("p", { class: "eyebrow", text: "Not found" }),
    h("h1", { class: "state-title", attrs: { id: "nf-title" }, text: heading }),
    h("p", { class: "state-body", text: body }),
    h(
      "a",
      { class: "pill-button", attrs: { href: "/" } },
      icon("feed"),
      h("span", { text: "Go to the feed" }),
    ),
  );
}

/** A card for when a load fails, with a retry button. */
export function errorCard(message: string, retry: () => void): HTMLElement {
  return h(
    "section",
    { class: "paper card state-card", attrs: { role: "alert" } },
    h("h2", { class: "state-title", text: "That didn't load" }),
    h("p", { class: "state-body", text: message }),
    h("button", {
      class: "pill-button",
      attrs: { type: "button" },
      text: "Try again",
      on: { click: retry },
    }),
  );
}

export function notFoundView(ctx: ViewContext): View {
  ctx.setTitle("Not found · Terrakin");
  const el = h("div", { class: "column page" }, notFoundCard());
  return { el, ready: Promise.resolve(), destroy() {} };
}
