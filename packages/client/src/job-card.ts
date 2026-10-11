/**
 * The home wall's card for the job you hold (RFC 0030): what it asks, how far along it is, and the
 * way to it. It shows only while you hold one. The wall never shows the day's board, so it has no
 * daily prompt. Loaded on its own, and only in a world where jobs are open.
 */
import { h, icon } from "@terrakin/ui/dom";
import { progressBar } from "@terrakin/ui/ui";
import { jobsApi } from "./api/jobs";
import { askedLine, heldBar, heldLine } from "./jobs";

/** The card, or null when you hold no job (or the board can't be read): the wall stays as it was. */
export async function heldJobCard(): Promise<HTMLElement | null> {
  const r = await jobsApi.jobs();
  const held = r.ok && r.data.open ? r.data.you?.held : null;
  if (!held) return null;
  const bar = heldBar(held);
  return h(
    "section",
    {
      class: "paper card stack job-card",
      attrs: { id: "job-card", "aria-labelledby": "job-card-title" },
    },
    h("h2", { class: "card-title", attrs: { id: "job-card-title" }, text: "Your job" }),
    h("p", { class: "job-held-title", text: held.title }),
    progressBar(bar.count, bar.total, bar.label),
    h("p", { class: "hint", text: `${askedLine(held.from)}. ${heldLine(held)}` }),
    h(
      "div",
      { class: "cluster" },
      h(
        "a",
        { class: "pill-button small", attrs: { href: "/town#jobs" } },
        icon("town"),
        h("span", { text: "Open your job" }),
      ),
    ),
  );
}
