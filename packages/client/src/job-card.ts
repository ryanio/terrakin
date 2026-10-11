/**
 * The home wall's card for the job you hold (RFC 0030): what it asks, how far along it is, and the
 * way to it. It shows only while you hold one. The wall never shows the day's board, so it has no
 * daily prompt. Loaded on its own, and only in a world where jobs are open.
 */
import type { HeldJobView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { progressBar } from "@terrakin/ui/ui";
import { jobsApi } from "./api/jobs";
import { askedLine, heldBar, heldJobLine } from "./jobs";

export interface HeldJobCard {
  /** The card, drawn for the job held when it was last read. */
  el: HTMLElement;
  /**
   * Read the board again and draw the job as it stands now. False once no job is held (finished,
   * let go, or lapsed): the card then says so in a place of the size it had, so nothing under it
   * moves, and the wall takes it away when it's out of sight. A read that fails leaves the card as
   * it is and answers true.
   */
  refresh(): Promise<boolean>;
}

/** The job held now, null for none, and undefined when the board can't be read. */
async function heldNow(): Promise<HeldJobView | null | undefined> {
  const r = await jobsApi.jobs();
  if (!r.ok) return undefined;
  return (r.data.open ? r.data.you?.held : null) ?? null;
}

/** The card, or null when you hold no job (or the board can't be read): the wall stays as it was. */
export async function heldJobCard(): Promise<HeldJobCard | null> {
  const first = await heldNow();
  if (!first) return null;
  const el = h("section", {
    class: "paper card stack job-card",
    attrs: { id: "job-card", "aria-labelledby": "job-card-title" },
  });
  const title = h("h2", { class: "card-title", attrs: { id: "job-card-title" }, text: "Your job" });
  const toTown = (words: string) =>
    h(
      "div",
      { class: "cluster" },
      h(
        "a",
        { class: "pill-button small", attrs: { href: "/town#jobs" } },
        icon("town"),
        h("span", { text: words }),
      ),
    );
  const paint = (held: HeldJobView) => {
    const bar = heldBar(held);
    el.replaceChildren(
      title,
      h("p", { class: "job-held-title", text: held.title }),
      progressBar(bar.count, bar.total, bar.label),
      h("p", { class: "hint", text: `${askedLine(held.from)}. ${heldJobLine(held)}` }),
      toTown("Open your job"),
    );
  };
  paint(first);
  return {
    el,
    async refresh() {
      const held = await heldNow();
      if (held === undefined) return true;
      if (held) {
        paint(held);
        return true;
      }
      el.style.minHeight = `${el.getBoundingClientRect().height}px`;
      el.replaceChildren(
        title,
        h("p", { class: "hint", text: "You're no longer holding this job." }),
        toTown("Today's jobs at the Town Hall"),
      );
      return false;
    },
  };
}
