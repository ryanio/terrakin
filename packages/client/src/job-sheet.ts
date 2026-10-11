/**
 * The job sheet in the world (RFC 0030). The chip that shows while you hold a job opens it on that
 * job: its bar, Hand in for a bring job, and Let go. A tap on a townsfolk who asks for something
 * today opens it on their job, with Take when the server says one can be taken, and a row to their
 * lessons when either of you has a recipe to teach the other. It draws from `job-parts.ts`, and
 * the board it shows is the world's: it hears every read the world makes (after your own job
 * events, and after its own buttons), so a job finished or let go elsewhere shows here at once.
 * Loaded on its own, when the chip or a giver is tapped.
 */
import type { JobsResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { closeOverlay, errorLine, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import {
  heldJob,
  jobActs,
  jobRow,
  present,
  problemAfterRead,
  repaintKeepingFocus,
} from "./job-parts";
import { cantTakeLine, sheetShows, weekLine } from "./jobs";

export interface JobSheetOptions {
  /** The board as the world last read it. */
  board: JobsResponse;
  /** A townsfolk tapped in the world: the sheet shows what they ask for today. Their name is text. */
  giver?: { id: string; name: string };
  /** Opens their teach sheet, when either of you has a recipe to teach the other. */
  lessons?: () => void;
  /** Have the world read the board again, after one of the sheet's own buttons. */
  reread: () => Promise<void>;
  /**
   * Hear each board the world keeps while the sheet is open (undefined once jobs aren't shown at
   * all). The function it returns stops it.
   */
  follow: (heard: (board: JobsResponse | undefined) => void) => () => void;
}

/**
 * Open the sheet. False, with nothing opened, when there's nothing to show: no job held and no
 * giver, or a giver with nothing on today's board.
 */
export function openJobSheet(o: JobSheetOptions): boolean {
  if (!sheetShows(o.board, o.giver?.id)) return false;

  const problem = errorLine("job-sheet-error");
  const body = h("div", { class: "stack job-sheet-body", attrs: { tabindex: -1 } });
  // A plain link: the router closes the sheet as it goes.
  const all = h(
    "a",
    { class: "pill-button small", attrs: { href: "/town#jobs" } },
    icon("town"),
    h("span", { text: "Today's jobs at the Town Hall" }),
  );
  const lessons = o.lessons
    ? h(
        "button",
        { class: "pill-button small job-lessons", attrs: { type: "button" } },
        icon("kitchen"),
        // A resident's name: text.
        h("span", { text: `Recipes with ${o.giver?.name ?? "them"}` }),
      )
    : null;
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
    h("div", { class: "cluster job-sheet-foot" }, lessons, all),
  );
  // The teach sheet takes this one's place.
  lessons?.addEventListener("click", () => o.lessons?.());

  const acts = jobActs({ within: body, problem, reread: o.reread });

  function paint(board: JobsResponse) {
    const { you } = board;
    const jobs = o.giver ? board.jobs.filter((job) => job.from.id === o.giver?.id) : [];
    const cant = cantTakeLine(you);
    repaintKeepingFocus(body, () =>
      body.replaceChildren(
        ...present([
          ...(jobs.length > 0
            ? [
                h("p", {
                  class: "sheet-lede",
                  text: `What they ask for today. A finished job adds ${board.rules.points} points to its skill, never coins.`,
                }),
                itemRows(
                  jobs.map((job) => jobRow(job, you, acts)),
                  { className: "job-rows" },
                ),
              ]
            : []),
          // The chip's sheet is titled "Your job" already; a giver's sheet says which job is yours.
          you?.held ? heldJob(you.held, board.day, acts, !o.giver) : null,
          you ? h("p", { class: "hint job-week", text: weekLine(you.week) }) : null,
          cant ? h("p", { class: "hint job-why", text: cant }) : null,
        ]),
      ),
    );
  }

  /** The world kept a board: draw it, or close once there's nothing left to show or to say. */
  function heard(board: JobsResponse | undefined) {
    if (board) problemAfterRead(problem, board.you);
    const empty = { jobs: [], you: null };
    if (!sheetShows(board ?? empty, o.giver?.id, problem.textContent ?? "")) {
      return closeOverlay(s.dialog);
    }
    // A refusal stays on screen over whatever is left, even when that's nothing.
    if (board) paint(board);
    else body.replaceChildren();
  }

  paint(o.board);
  openOverlay(s.dialog, o.follow(heard));
  return true;
}
