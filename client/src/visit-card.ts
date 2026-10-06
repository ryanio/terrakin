/**
 * The card in the world while you stand on someone else's plot (RFC 0020): whose plot it is, this
 * week's visitors and admirers, Admire, and Next plot, which visits the next plot in the Visit
 * page's order so you can tour the town without leaving the world. `world.ts` calls `update` every
 * frame with where the server has you; the card only changes when the plot under you does. Names
 * are residents' words: text only.
 */
import type { PlotView } from "@terrakin/protocol";
import { canBuildOn, plotKey, plotOf } from "@terrakin/sim";
import { profilePath } from "@terrakin/ui/paths";
import { whileBusy } from "@terrakin/ui/ui";
import { api } from "./api";
import type { Mirror } from "./mirror";
import { nextPlot, plotName, weekLine } from "./visits";

/** How long the tour's list of plots is good for before Next plot asks again. */
const LIST_MS = 60_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface VisitCardOptions {
  /** Jump to plot (px, py): the world sends `visit` over its socket. */
  visit: (px: number, py: number) => void;
  /** Say something in the world's toast. */
  toast: (text: string) => void;
}

export interface VisitCard {
  /** Where the server has you now, or nothing when you're not in the world. */
  update(
    mirror: Mirror | undefined,
    me: string | undefined,
    at: { x: number; y: number } | undefined,
  ): void;
  hide(): void;
}

export function visitCard(o: VisitCardOptions): VisitCard {
  const el = $("visit-card");
  const owner = $<HTMLAnchorElement>("visit-card-owner");
  const week = $("visit-card-week");
  const admire = $<HTMLButtonElement>("visit-admire");
  const admireLabel = admire.querySelector("span") as HTMLSpanElement;
  const next = $<HTMLButtonElement>("visit-next");

  /** The plot the card is about, as "px,py", and its coordinates. */
  let key: string | null = null;
  let plot: { px: number; py: number } | null = null;
  let me: string | null = null;
  /** Bumped whenever the card moves to another plot, so a late answer for the last one is dropped. */
  let generation = 0;
  /** Where you were and the mirror's `seq` at the last look, so a still frame does no work. */
  let looked = "";
  let tour: { plots: PlotView[]; at: number } | null = null;

  function paint(view: PlotView) {
    week.textContent = weekLine(view);
    const done = view.admiredToday === true;
    admire.disabled = done;
    admireLabel.textContent = done ? "Admired today" : "Admire";
  }

  function show(mirror: Mirror, px: number, py: number) {
    generation++;
    key = plotKey(px, py);
    plot = { px, py };
    const ownerId = mirror.plots.get(key) ?? "";
    const names = [ownerId, ...(mirror.coOwners.get(key) ?? [])].map(
      (id) => mirror.residents.get(id)?.name ?? "A neighbor",
    );
    owner.textContent = plotName(names);
    owner.href = profilePath(ownerId);
    week.textContent = "";
    admire.disabled = false;
    admireLabel.textContent = "Admire";
    el.hidden = false;
    const mine = generation;
    void api.plot(px, py).then((r) => {
      if (mine === generation && r.ok) paint(r.data.plot);
    });
  }

  function hide() {
    generation++;
    key = null;
    plot = null;
    looked = "";
    el.hidden = true;
  }

  admire.addEventListener("click", async () => {
    const here = plot;
    if (!here) return;
    const mine = generation;
    const name = owner.textContent ?? "this plot";
    const r = await whileBusy(admire, () => api.admirePlot(here.px, here.py));
    if (!r.ok) return o.toast(r.message);
    if (mine === generation) paint(r.data.plot);
    o.toast(`You admired ${name}. They'll be glad.`);
  });

  /** The plots to tour, in the Visit page's order, fetched again once a minute. */
  async function tourPlots(): Promise<PlotView[] | string> {
    if (tour && performance.now() - tour.at < LIST_MS) return tour.plots;
    const r = await api.plots();
    if (!r.ok) return r.message;
    tour = { plots: r.data.plots, at: performance.now() };
    return tour.plots;
  }

  next.addEventListener("click", async () => {
    const plots = await whileBusy(next, tourPlots);
    if (typeof plots === "string") return o.toast(plots);
    const to = nextPlot(plots, plot, me);
    if (!to) return o.toast("There's no other plot to visit yet.");
    o.visit(to.px, to.py);
  });

  return {
    update(mirror, who, at) {
      me = who ?? null;
      if (!mirror || !who || !at) {
        if (key !== null) hide();
        return;
      }
      const { px, py } = plotOf(mirror.config, at.x, at.y);
      const here = plotKey(px, py);
      // A plot changes hands, or gets shared, only with an event, which moves `seq`.
      const look = `${who} ${here} ${mirror.seq}`;
      if (look === looked) return;
      looked = look;
      const ownerId = mirror.plots.get(here);
      const yours =
        ownerId !== undefined &&
        canBuildOn({ ownerId, coOwners: [...(mirror.coOwners.get(here) ?? [])] }, who);
      if (ownerId === undefined || yours) {
        if (key !== null) hide();
        return;
      }
      if (here !== key) show(mirror, px, py);
    },
    hide,
  };
}
