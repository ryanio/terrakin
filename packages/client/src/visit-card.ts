/**
 * The card in the world while you stand on a plot someone lives on (RFC 0020): the plot's name and
 * whose plot it is (decision 0121), this week's visitors and admirers, and Next plot, which visits
 * the next plot in the Visit page's order so you can tour the town without leaving the world. On
 * someone else's plot it has Admire, and on October 31 and November 1 Trick or treat (RFC 0022),
 * shown by the sim's own `trickOrTreatDay`, which knocks at the plot's door. On your own, or one
 * shared with you, it has Name your plot instead. `world.ts` calls `update` every frame with where
 * the server has you; the card only changes when the plot under you, its name, or the world's day
 * does. Names are residents' words: text only.
 */
import type { PlotView } from "@terrakin/protocol";
import { canBuildOn, plotKey, plotOf, trickOrTreatDay } from "@terrakin/sim";
import { profilePath } from "@terrakin/ui/paths";
import { whileBusy } from "@terrakin/ui/ui";
import { api } from "./api";
import type { Mirror } from "./mirror";
import { openPlotNameSheet } from "./plot-name-sheet";
import { nextPlot, plotName, weekLine } from "./visits";

/** How long the tour's list of plots is good for before Next plot asks again. */
const LIST_MS = 60_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface VisitCardOptions {
  /**
   * Jump to plot (px, py): the world sends `visit` over its socket. The message's id, or
   * undefined when it couldn't be sent.
   */
  visit: (px: number, py: number) => string | undefined;
  /** Knock at plot (px, py)'s door on a Halloween night: the message's id, or undefined. */
  knock: (px: number, py: number) => string | undefined;
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
  /**
   * The server turned down the message with this id, with this code: a tour's visit, or a knock,
   * maybe.
   */
  refused(id: string, code?: string): void;
  /** You knocked at plot (px, py) tonight: the server said so with `trick_or_treated`. */
  knocked(px: number, py: number): void;
  /** How far down the screen the card reaches, in CSS pixels: 0 while it's hidden. */
  bottom(): number;
}

export function visitCard(o: VisitCardOptions): VisitCard {
  const el = $("visit-card");
  const owner = $<HTMLAnchorElement>("visit-card-owner");
  const whose = $("visit-card-whose");
  const week = $("visit-card-week");
  const admire = $<HTMLButtonElement>("visit-admire");
  const admireLabel = admire.querySelector("span") as HTMLSpanElement;
  const nameIt = $<HTMLButtonElement>("visit-name");
  const nameLabel = nameIt.querySelector("span") as HTMLSpanElement;
  const knock = $<HTMLButtonElement>("visit-knock");
  const knockLabel = knock.querySelector("span") as HTMLSpanElement;
  const next = $<HTMLButtonElement>("visit-next");

  /** The plot the card is about, as "px,py", and its coordinates. */
  let key: string | null = null;
  let plot: { px: number; py: number } | null = null;
  let me: string | null = null;
  /** Whether it's yours or shared with you, and its name as the mirror has it. */
  let yours = false;
  let named: string | undefined;
  /** Bumped whenever the card moves to another plot, so a late answer for the last one is dropped. */
  let generation = 0;
  /** Where you were and the mirror's `seq` at the last look, so a still frame does no work. */
  let looked = "";
  let tour: { plots: PlotView[]; at: number } | null = null;
  /** The tour's last visit, until it's answered, and the plots whose visit was turned down. */
  let sent: { id: string; key: string } | null = null;
  const passed = new Set<string>();
  /** The world's day, the doors you knocked at on it, and the knock waiting for its answer. */
  let day: number | undefined;
  const knocked = new Set<string>();
  let knocking: { id: string; key: string } | null = null;

  /**
   * Trick or treat: there on October 31 and November 1 only, at a neighbor's door, and "Knocked"
   * once you have at this door that UTC day.
   */
  function paintKnock() {
    knock.hidden = yours || !trickOrTreatDay(day);
    const done = key !== null && knocked.has(key);
    knockLabel.textContent = done ? "Knocked" : "Trick or treat";
    knock.disabled = done || (knocking !== null && knocking.key === key);
  }

  function paint(view: PlotView) {
    week.textContent = weekLine(view);
    const done = view.admiredToday === true;
    admire.disabled = done;
    admireLabel.textContent = done ? "Admired today" : "Admire";
    // The server knows tonight's knocks, so a reload still says "Knocked" (RFC 0022).
    if (view.knockedToday && key !== null) {
      knocked.add(key);
      paintKnock();
    }
  }

  /** The plot's name as the title, with whose it is under it; whose it is alone without a name. */
  function paintNames(mirror: Mirror) {
    if (key === null) return;
    const ownerId = mirror.plots.get(key) ?? "";
    named = mirror.plotNames.get(key);
    const names = [ownerId, ...(mirror.coOwners.get(key) ?? [])].map(
      (id) => mirror.residents.get(id)?.name ?? "A neighbor",
    );
    const whoseLine = ownerId === me ? "Your plot" : plotName(names);
    owner.textContent = named ?? whoseLine;
    owner.href = profilePath(ownerId);
    whose.textContent = named ? whoseLine : "";
    whose.hidden = !named;
    nameLabel.textContent = named ? "Rename" : "Name your plot";
  }

  function show(mirror: Mirror, px: number, py: number, own: boolean) {
    generation++;
    key = plotKey(px, py);
    plot = { px, py };
    yours = own;
    paintNames(mirror);
    week.textContent = "";
    admire.hidden = own;
    admire.disabled = false;
    admireLabel.textContent = "Admire";
    nameIt.hidden = !own;
    paintKnock();
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

  nameIt.addEventListener("click", () => {
    if (!plot) return;
    openPlotNameSheet({ ...plot, name: named }, { say: o.toast });
  });

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

  knock.addEventListener("click", () => {
    const here = plot;
    if (!here || key === null) return;
    const id = o.knock(here.px, here.py);
    if (id === undefined) return;
    knocking = { id, key };
    paintKnock();
  });

  next.addEventListener("click", async () => {
    const plots = await whileBusy(next, tourPlots);
    if (typeof plots === "string") return o.toast(plots);
    const to = nextPlot(plots, plot, me, passed);
    if (!to) return o.toast("There's no other plot to visit yet.");
    const id = o.visit(to.px, to.py);
    sent = id === undefined ? null : { id, key: plotKey(to.px, to.py) };
  });

  return {
    update(mirror, who, at) {
      me = who ?? null;
      if (!mirror || !who || !at) {
        if (key !== null) hide();
        return;
      }
      if (mirror.day !== day) {
        // A new day: last night's knocks are done with.
        day = mirror.day;
        knocked.clear();
        knocking = null;
        if (key !== null) paintKnock();
      }
      const { px, py } = plotOf(mirror.config, at.x, at.y);
      const here = plotKey(px, py);
      // A plot changes hands, or gets shared, only with an event, which moves `seq`.
      const look = `${who} ${here} ${mirror.seq}`;
      if (look === looked) return;
      looked = look;
      const ownerId = mirror.plots.get(here);
      if (ownerId === undefined) {
        if (key !== null) hide();
        return;
      }
      const own = canBuildOn({ ownerId, coOwners: [...(mirror.coOwners.get(here) ?? [])] }, who);
      // A share given or taken back changes which card this is; anything else, only its words.
      if (here !== key || own !== yours) show(mirror, px, py, own);
      else paintNames(mirror);
    },
    hide,
    refused(id, code) {
      if (knocking?.id === id) {
        // The world said why (`world.ts` shows it). Knocked here already: the button says so; any
        // other answer leaves it to try again, or another door.
        if (code === "already_knocked") knocked.add(knocking.key);
        knocking = null;
        paintKnock();
      }
      // A plot whose owner blocked you, say, stays in the list: the tour goes past it from now on.
      if (sent?.id !== id) return;
      passed.add(sent.key);
      sent = null;
    },
    knocked(px, py) {
      const at = plotKey(px, py);
      knocked.add(at);
      if (knocking?.key === at) knocking = null;
      if (key !== null) paintKnock();
    },
    // Hidden by the stylesheet too, while chat is open or building: then it has no height.
    bottom: () => (el.hidden ? 0 : el.getBoundingClientRect().bottom),
  };
}
