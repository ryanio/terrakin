/**
 * The job sheet in the world (RFC 0030). The chip that shows while you hold a job opens it on that
 * job: its bar, Hand in for a bring job, and Let go. A tap on a townsfolk who asks for something
 * today opens it on their job, with Take when the server says one can be taken. Both read the same
 * board (`GET /v1/jobs`) and draw from `job-parts.ts`; after each action the sheet reads it again.
 * Loaded on its own, when the chip or a giver is tapped.
 */
import type { JobsResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { closeOverlay, errorLine, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import { jobsApi } from "./api/jobs";
import { type GiverPerson, heldJob, jobRow, present } from "./job-parts";
import { cantTakeLine, weekLine } from "./jobs";

export interface JobSheetOptions {
  /** The board as the world last read it. */
  board: JobsResponse;
  /** A townsfolk tapped in the world: the sheet shows what they ask for today. Their name is text. */
  giver?: { id: string; name: string };
  /** How to draw a giver who lives here. */
  person: GiverPerson;
  /** The board was read again after an action: the world keeps it. */
  read: (board: JobsResponse) => void;
}

/**
 * Open the sheet. False, with nothing opened, when there's nothing to show: no job held and no
 * giver, or a giver with nothing on today's board.
 */
export function openJobSheet(o: JobSheetOptions): boolean {
  const theirs = (board: JobsResponse) =>
    o.giver ? board.jobs.filter((job) => job.from.id === o.giver?.id) : [];
  /** A giver's sheet is about what they ask today, and the chip's about the job you hold. */
  const nothing = (board: JobsResponse) =>
    o.giver ? theirs(board).length === 0 : !board.you?.held;
  if (nothing(o.board)) return false;

  const problem = errorLine("job-sheet-error");
  const body = h("div", { class: "stack job-sheet-body" });
  // A plain link: the router closes the sheet as it goes.
  const all = h(
    "a",
    { class: "pill-button small", attrs: { href: "/town#jobs" } },
    icon("town"),
    h("span", { text: "Today's jobs at the Town Hall" }),
  );
  const s = sheet(
    {
      id: "job-sheet-title",
      // A giver's name is a resident's: `sheet` puts the title in as text.
      title: o.giver ? o.giver.name : "Your job",
      className: "job-sheet",
      closeOnBackdrop: true,
    },
    body,
    problem,
    h("div", { class: "cluster" }, all),
  );

  const acts = {
    changed: () => void reread(),
    problem: (text: string) => {
      problem.textContent = text;
    },
  };

  function paint(board: JobsResponse) {
    const { you } = board;
    const jobs = theirs(board);
    const cant = cantTakeLine(you);
    body.replaceChildren(
      ...present([
        ...(jobs.length > 0
          ? [
              h("p", {
                class: "sheet-lede",
                text: `What they ask for today. A finished job adds ${board.rules.points} points to its skill, never coins.`,
              }),
              itemRows(
                jobs.map((job) => jobRow(job, you, o.person, acts)),
                { className: "job-rows" },
              ),
            ]
          : []),
        // The chip's sheet is titled "Your job" already; a giver's sheet says which job is yours.
        you?.held ? heldJob(you.held, board.day, o.person, acts, !o.giver) : null,
        you ? h("p", { class: "hint job-week", text: weekLine(you.week) }) : null,
        cant ? h("p", { class: "hint job-why", text: cant }) : null,
      ]),
    );
  }

  async function reread() {
    const r = await jobsApi.jobs();
    if (!r.ok) {
      problem.textContent = r.message;
      return;
    }
    o.read(r.data);
    if (!s.dialog.isConnected) return;
    // Let go of, handed in, or finished, with nothing else to show: the sheet is done.
    if (nothing(r.data)) return closeOverlay(s.dialog);
    paint(r.data);
  }

  paint(o.board);
  openOverlay(s.dialog);
  return true;
}
