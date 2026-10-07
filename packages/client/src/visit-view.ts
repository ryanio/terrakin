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
import { kindPill, linkTabs, stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { actProblem, api } from "./api";
import { savedResidentId, savedToken } from "./net";
import { plotThumb } from "./plot-thumb";
import { skeletonCards } from "./post-card";
import { errorCard, type View, type ViewContext } from "./view";
import { isMine, plotTitles, weekLine } from "./visits";

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
 * Jump to plot (px, py) and open the world there. Already standing on it is where you wanted to
 * be too. Any other refusal is said in a toast.
 */
async function visit(
  button: HTMLButtonElement,
  plot: { px: number; py: number },
  navigate: (path: string) => void,
) {
  const r = await whileBusy(button, () => api.act({ type: "visit", px: plot.px, py: plot.py }));
  const there = r.ok && !r.data.ok && r.data.error.code === "already_there";
  const problem = there ? null : actProblem(r);
  if (problem) return toast(problem);
  navigate("/world");
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
    return h(
      "a",
      { class: `pill-button small visit-button ${className}`.trim(), attrs: { href: "/world" } },
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
  button.addEventListener("click", () => void visit(button, plot, navigate));
  return button;
}

/**
 * A plot's picture and name as one tap that visits it, as Visit does, or a link into the world for
 * someone who hasn't joined. For other people's plots: the home wall's strip never shows your own.
 */
export function visitTap(
  plot: Pick<PlotView, "px" | "py">,
  name: string,
  me: string | null,
  navigate: (path: string) => void,
  className: string,
  ...children: (Node | null)[]
): HTMLElement {
  const label = `Visit ${name}`;
  if (me === null) {
    return h(
      "a",
      { class: className, attrs: { href: "/world", "aria-label": label } },
      ...children,
    );
  }
  const button = h(
    "button",
    { class: className, attrs: { type: "button", "aria-label": label } },
    ...children,
  );
  button.addEventListener("click", () => void visit(button, plot, navigate));
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
    h("div", { class: "plot-card-foot" }, visitButton(plot, me, navigate)),
  );
}

export function visitView(ctx: ViewContext): View {
  ctx.setTitle("Plots to visit · Terrakin");
  const asked = new URLSearchParams(location.search).get("sort");
  const sort: PlotSort = PLOT_SORTS.find((s) => s === asked) ?? "recent";
  const me = savedToken() ? savedResidentId() : null;
  const go = (path: string) => ctx.navigate(path, { replace: true });
  const body = h("div", { class: "stack cards visit-body" }, ...skeletonCards(2));
  const el = h(
    "div",
    { class: "column stack cards page visit-page" },
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
    body,
  );
  let destroyed = false;

  async function load(): Promise<void> {
    const [p, w] = await Promise.all([api.plots(sort), api.world()]);
    if (destroyed) return;
    if (!p.ok) {
      body.replaceChildren(errorCard(p.message, () => void load()));
      return;
    }
    const world = w.ok ? w.data : undefined;
    const { plots } = p.data;
    body.replaceChildren(
      ...(plots.length > 0
        ? plots.map((plot) => plotCard(plot, world, me, ctx.navigate))
        : [
            stateCard({
              title: "Nobody lives here yet",
              body: "Once residents settle plots and build, their homes show up here to visit.",
            }),
          ]),
    );
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
