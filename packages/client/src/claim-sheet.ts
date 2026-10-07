/**
 * The "Claim plot" picker (decision 0143): for someone with no plot, a sheet of the empty plots
 * `settle` would take, nearest to plots people live on first (`plotPicks`), each drawn with the
 * plots around it. Picking one sends `settle`, which claims it from anywhere and puts you there;
 * the world then asks about a home (`home-sheet.ts`). Neighbors' names are their words: text only.
 */
import { h } from "@terrakin/ui/dom";
import {
  closeOverlay,
  emptyNote,
  errorLine,
  itemRow,
  itemRows,
  moreButton,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { pickNeighbors, pickWhere, plotPicks } from "./plot-picks";
import { plotArea } from "./plot-thumb";
import { worldProblem } from "./things";

/** Plots the sheet shows at first, and how many more each "Show more" adds. */
const PAGE = 5;
/** How wide each plot's picture is, with its neighbors around it, in CSS pixels. */
const AREA_PX = 72;

/** Open the picker. It loads the world itself, so it shows who lives where right now. */
export function openClaimSheet() {
  const error = errorLine("claim-error");
  const body = h(
    "div",
    { class: "stack claim-body" },
    h("p", { class: "hint", text: "Finding empty plots…" }),
  );
  const s = sheet(
    {
      id: "claim-title",
      title: "Pick a plot",
      className: "claim-sheet",
      closeOnBackdrop: true,
      lede: "Pick an empty plot for your home. The ones beside neighbors come first, and you move in as soon as you pick.",
    },
    error,
    body,
  );
  openOverlay(s.dialog);
  s.card.focus();
  void fill();

  async function fill() {
    const r = await api.world();
    if (!overlayShowing(s.dialog)) return;
    if (!r.ok) {
      body.replaceChildren();
      error.textContent = r.message;
      return;
    }
    const world = r.data;
    const picks = plotPicks(world);
    if (picks.length === 0) {
      body.replaceChildren(
        emptyNote("Every plot is taken", "There's no empty plot right now. Try again later."),
      );
      return;
    }
    const names = new Map(world.residents.map((p) => [p.id, p.name]));
    const row = (pick: (typeof picks)[number]) => {
      const where = pickWhere(pick, world.commons);
      const near = pickNeighbors(pick.neighbors.flatMap((id) => names.get(id) ?? []));
      const live = h("button", {
        class: "btn-primary small",
        attrs: { type: "button", "data-plot": `${pick.px},${pick.py}` },
        text: "Live here",
      });
      live.addEventListener("click", () => void settle(live, pick));
      return itemRow({
        lead: plotArea(world, pick, `${where}, with the plots around it`, AREA_PX),
        name: where,
        lines: [near],
        trail: live,
        className: "claim-pick",
      });
    };
    let shown = Math.min(PAGE, picks.length);
    const list = itemRows(picks.slice(0, shown).map(row), { className: "claim-list" });
    const more = moreButton("Show more plots", async () => {
      const next = picks.slice(shown, shown + PAGE);
      list.append(...next.map(row));
      shown += next.length;
      more.el.hidden = shown >= picks.length;
      return undefined;
    });
    more.el.hidden = shown >= picks.length;
    body.replaceChildren(list, more.el);
  }

  /** Settle on the plot. Taken meanwhile, its button says so and the rest stay to pick from. */
  async function settle(button: HTMLButtonElement, pick: { px: number; py: number }) {
    error.textContent = "";
    const r = await whileBusy(button, () => api.act({ type: "settle", px: pick.px, py: pick.py }));
    if (r.ok && r.data.ok) {
      // The world hears `plot_claimed` and asks about a home next.
      closeOverlay(s.dialog);
      return;
    }
    if (!overlayShowing(s.dialog)) return;
    const refused = r.ok && !r.data.ok ? r.data.error : undefined;
    if (refused?.code === "plot_owned") {
      button.disabled = true;
      button.textContent = "Taken";
      error.textContent = "Someone just moved in there. Pick another plot.";
      return;
    }
    error.textContent = refused
      ? worldProblem(refused.code, refused.message, { hasPlot: false })
      : (actProblem(r) ?? "");
  }
}
