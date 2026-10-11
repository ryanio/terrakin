/**
 * The Town Hall's Jobs section (RFC 0030), at `/town#jobs`: the job you hold, today's three jobs
 * with a Take button each when the server says one can be taken, how many are left this week, and
 * the way to the bounties, which pay coins where jobs pay points. Someone not signed in sees the
 * board, no buttons, and how to get one. Nothing shows until the server says jobs are open in this
 * world.
 */
import type { JobsResponse } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { errorLine, itemRows } from "@terrakin/ui/ui";
import { jobsApi } from "./api/jobs";
import {
  type GiverPerson,
  heldJob,
  jobActs,
  jobRow,
  present,
  problemAfterRead,
  repaintKeepingFocus,
} from "./job-parts";
import { boardLede, cantTakeLine, newestOnly, weekLine } from "./jobs";

export interface JobsSection {
  /** The section's heading and its card, for the page's main column once jobs are open. */
  els: HTMLElement[];
  /** Read the board and draw it again if anything changed. */
  refresh(): Promise<void>;
}

export function jobsSection(o: {
  /** How to draw a giver who lives here, from the world the page already read. */
  person: GiverPerson;
  /** The page went away: an answer that lands after is dropped. */
  gone: () => boolean;
}): JobsSection {
  const title = h("h2", {
    class: "section-title",
    attrs: { id: "jobs", hidden: true },
    text: "Jobs",
  });
  const card = h("section", {
    class: "stack paper card jobs-card",
    // Focusable, so focus has somewhere to go when the button it was on is drawn away.
    attrs: { "aria-labelledby": "jobs", hidden: true, tabindex: -1 },
  });
  const problem = errorLine("jobs-error");
  let painted = "";
  let landed = false;

  /**
   * Read the board and draw it. A read that fails leaves what's drawn, as a page's refresh does,
   * and only a world that says jobs are closed hides the section. A refresh on the page's timer
   * that went out before a Take never lands after the Take's own read.
   */
  const refresh = newestOnly(
    () => jobsApi.jobs(),
    (r) => {
      if (o.gone() || !r.ok) return;
      title.hidden = !r.data.open;
      card.hidden = !r.data.open;
      if (!r.data.open) return;
      problemAfterRead(problem, r.data.you);
      // Only a change is drawn again, so a button you're about to tap stays put.
      const next = JSON.stringify(r.data);
      if (next !== painted) {
        painted = next;
        repaintKeepingFocus(card, () => paint(r.data));
      }
      // A link to the section lands on it once.
      if (!landed && location.hash === "#jobs") {
        landed = true;
        requestAnimationFrame(() => title.scrollIntoView({ block: "start" }));
      }
    },
  );
  const acts = jobActs({ within: card, problem, reread: refresh });

  function paint(data: JobsResponse) {
    const { jobs, you, rules } = data;
    const cant = cantTakeLine(you);
    card.replaceChildren(
      ...present([
        h("p", { class: "town-lede", text: boardLede(rules, you !== null) }),
        you?.held ? heldJob(you.held, data.day, o.person, acts) : null,
        itemRows(
          jobs.map((job) => jobRow(job, you, o.person, acts)),
          { className: "job-rows" },
        ),
        you ? h("p", { class: "hint job-week", text: weekLine(you.week) }) : null,
        cant ? h("p", { class: "hint job-why", text: cant }) : null,
        problem,
        h(
          "p",
          { class: "hint job-bounties" },
          "Work that pays coins is on the ",
          h("a", { attrs: { href: "/bounties" }, text: "bounties" }),
          " page.",
        ),
      ]),
    );
  }

  return { els: [title, card], refresh };
}
