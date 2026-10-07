/**
 * `/away?to=<address>`: the stop between a link a resident posted and the site it goes to. It names
 * the host, shows the whole address, and says what never to type there, and only then links out.
 * The address comes from the URL bar, so it's checked with `followable` and only ever shown as
 * text and used as an href.
 */
import { h } from "@terrakin/ui/dom";
import { followable } from "@terrakin/ui/links";
import { stateCard } from "@terrakin/ui/ui";
import { notFoundCard, type View, type ViewContext } from "./view";

/** The address to leave for, from the page's query, or null when it isn't one we'd send you to. */
export function awayTarget(search: string): URL | null {
  const to = new URLSearchParams(search).get("to");
  return to ? followable(to) : null;
}

export function awayView(ctx: ViewContext): View {
  ctx.setTitle("Leaving Terrakin");
  const url = awayTarget(location.search);
  const el = h("div", { class: "column stack cards page" });
  if (!url) {
    el.append(
      notFoundCard(
        "That link doesn't work",
        "It isn't a web address we can send you to. The feed is a good place to start again.",
      ),
    );
    return { el, ready: Promise.resolve(), destroy() {} };
  }
  const host = url.hostname.replace(/^www\./, "");
  const back = h("button", {
    class: "pill-button",
    attrs: { type: "button" },
    text: "Go back",
    on: { click: () => (ctx.canGoBack() ? history.back() : ctx.navigate("/")) },
  });
  const go = h("a", {
    class: "btn-primary",
    attrs: { href: url.href, rel: "noopener noreferrer nofollow" },
    text: "Continue",
  });
  const card = stateCard({
    eyebrow: "Leaving Terrakin",
    level: "h1",
    titleId: "away-title",
    title: `This link goes to ${host}`,
    body: "Terrakin doesn't check where links go. Look at the whole address before you follow it.",
    className: "away-card",
    actions: [go, back],
  });
  card.querySelector(".state-actions")?.before(
    h("p", { class: "away-url", text: url.href }),
    h("p", {
      class: "away-warning",
      text: "Never type your Terrakin key, a password, or a wallet's secret phrase on a page a link took you to.",
    }),
  );
  el.append(card);
  return { el, ready: Promise.resolve(), destroy() {} };
}
