/**
 * `/visit`: plots to visit (RFC 0020). Every plot someone lives on as a card: a drawing of it from
 * above, its name (decision 0121) and whose it is, when it last changed, and this week's visitors
 * and admirers, with a Visit button that jumps you there and opens the world. Newest change first,
 * or most admired. The Galleries page is the other tab of the same place. Names are residents'
 * words: text only.
 */
import { PLOT_SORTS, type PlotSort, type PlotView, type WorldSnapshot } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { personLink } from "@terrakin/ui/people";
import { skeletonTiles } from "@terrakin/ui/skeleton";
import { copyButton, kindPill, linkTabs, stateCard, wideLayout } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api } from "./api";

import { savedResidentId, savedToken } from "./net";
import { pageData, withOptional } from "./page-data";
import { plotThumb } from "./plot-thumb";
import { failInto, type View, type ViewContext } from "./view";
import { visitPlot } from "./visit-plot";
import { isMine, plotTitles, weekLine } from "./visits";
import { worldLinkPath } from "./world-link";

const SORT_WORDS: Record<PlotSort, string> = {
  recent: "Recently changed",
  admired: "Most admired",
};

/** The switch between plots to visit and galleries, at the top of both pages. */
export function placeTabs(current: "visit" | "galleries", go?: (path: string) => void) {
  return linkTabs(
    [
      { href: "/visit", current: current === "visit", content: ["Plots"] },
      { href: "/galleries", current: current === "galleries", content: ["Galleries"] },
    ],
    { label: "Places to visit", className: "place-tabs", ...(go ? { go } : {}) },
  );
}

/**
 * What a plot card offers: Visit, a way in for someone who hasn't joined, or a note that it's
 * yours. `me` is null without a saved key.
 */
export function visitButton(
  plot: Pick<PlotView, "px" | "py" | "owner" | "coOwners" | "name">,
  me: string | null,
  navigate: (path: string) => void,
  className = "",
): HTMLElement {
  if (me === null) {
    // The world opens looking at the plot, with a way to step inside from there (decision 0162).
    return h(
      "a",
      {
        class: `pill-button small visit-button ${className}`.trim(),
        attrs: { href: worldLinkPath({ kind: "plot", px: plot.px, py: plot.py }) },
      },
      h("span", { text: "Step in to visit" }),
    );
  }
  if (isMine(plot, me)) return kindPill("Your plot", "moss", "visit-yours");
  const button = h(
    "button",
    {
      class: `pill-button small visit-button ${className}`.trim(),
      attrs: { type: "button", "aria-label": `Visit ${plotTitles(plot, [plot.owner.name]).title}` },
    },
    icon("world"),
    h("span", { text: "Visit" }),
  );
  button.addEventListener("click", () => void visitPlot(button, plot, navigate));
  return button;
}

/** Copy link: the world opening on this plot (decision 0162), to send to someone. */
function copyPlaceLink(plot: Pick<PlotView, "px" | "py">, title: string): HTMLElement {
  const label = h("span", { text: "Copy link" });
  // The plot's name is in the button's name as hidden words, so the name follows "Copied".
  const button = h(
    "button",
    { class: "pill-button small", attrs: { type: "button" } },
    icon("link"),
    label,
    h("span", { class: "visually-hidden", text: ` to ${title}` }),
  );
  const path = worldLinkPath({ kind: "plot", px: plot.px, py: plot.py });
  copyButton(button, label, () => new URL(path, location.origin).href, {
    idle: "Copy link",
    failed: "Couldn't copy the link",
  });
  return button;
}

/** "Changed 2h", from when something on the plot last changed. Null when that's unknown. */
function changedLine(plot: PlotView): HTMLElement | null {
  if (!plot.changedAt) return null;
  const when = timeAgo(plot.changedAt);
  if (when.textContent === "now") when.textContent = "just now";
  return h("span", { class: "plot-card-changed" }, "Changed ", when);
}

/**
 * One plot to visit: its drawing, its name and whose it is, how lately it changed, and this week's
 * counts.
 */
export function plotCard(
  plot: PlotView,
  world: WorldSnapshot | undefined,
  me: string | null,
  navigate: (path: string) => void,
): HTMLElement {
  const people = [plot.owner, ...plot.coOwners];
  const { title } = plotTitles(
    plot,
    people.map((p) => p.name),
  );
  return h(
    "section",
    {
      class: "paper card plot-card",
      attrs: { "data-plot": `${plot.px},${plot.py}`, "aria-label": title },
    },
    world ? plotThumb(world, plot, `${title}, from above`) : h("span", { class: "plot-thumb" }),
    h(
      "div",
      { class: "stack tight plot-card-body" },
      plot.name ? h("h2", { class: "plot-card-name", text: plot.name }) : null,
      h("div", { class: "cluster plot-card-people" }, ...people.map((p) => personLink(p))),
      changedLine(plot),
      h("span", { class: "plot-card-week", text: weekLine(plot) }),
      plot.gallery ? kindPill("Gallery", "sun", "plot-card-gallery") : null,
    ),
    h(
      "div",
      { class: "cluster plot-card-foot" },
      copyPlaceLink(plot, title),
      visitButton(plot, me, navigate),
    ),
  );
}

export function visitView(ctx: ViewContext): View {
  ctx.setTitle("Plots to visit · Terrakin");
  const asked = new URLSearchParams(location.search).get("sort");
  const sort: PlotSort = PLOT_SORTS.find((s) => s === asked) ?? "recent";
  const me = savedToken() ? savedResidentId() : null;
  const go = (path: string) => ctx.navigate(path, { replace: true });
  // Every plot as a card, side by side as the width allows.
  const body = h("div", { class: "card-grid visit-body" }, ...skeletonTiles());
  const { el, head, main } = wideLayout("visit-page");
  main.append(body);
  head.append(
    h("h1", { class: "page-title", text: "Plots to visit" }),
    placeTabs("visit", go),
    h("p", {
      class: "hint",
      text: "The homes residents built, each drawn from above. Visit one to stand at its door, look around, and admire it once a day if you like what you see.",
    }),
    linkTabs(
      PLOT_SORTS.map((s) => ({
        href: s === "recent" ? "/visit" : `/visit?sort=${s}`,
        current: s === sort,
        content: [SORT_WORDS[s]],
      })),
      { label: "Order", className: "visit-sorts", go },
    ),
  );

  const loader = pageData({
    // The world draws each plot's picture; the cards show without it.
    ask: () => withOptional(api.plots(sort), api.world()),
    fail: failInto(body),
    paint: ([{ plots }, world]) =>
      body.replaceChildren(
        ...(plots.length > 0
          ? plots.map((plot) => plotCard(plot, world ?? undefined, me, ctx.navigate))
          : [
              stateCard({
                title: "Nobody lives here yet",
                body: "Once residents settle plots and build, their homes show up here to visit.",
              }),
            ]),
      ),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
