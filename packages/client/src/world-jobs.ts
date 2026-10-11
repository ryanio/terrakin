/**
 * The town's jobs in the world (RFC 0030): a chip while you hold one ("Job: 1 of 3", which opens
 * its sheet), a toast for each deed that moves it and for finishing it, in the same line as the
 * coins and things that deed brought, a note over each townsfolk who asks for something today, and
 * their job's sheet when you tap them. The board comes from `GET /v1/jobs`, read on the way in, at
 * each new day, and after each of your own job events, which the socket sends only to you. Nothing
 * here runs until the world says jobs are open, and nothing decides: the words are `jobs.ts`'s.
 */
import type { JobsResponse, WorldEvent } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { jobsApi } from "./api/jobs";
import type { GiverPerson } from "./job-parts";
import { chipLabel, doneLine, droppedLine, type JobAsked, progressLine } from "./jobs";

export interface WorldJobs {
  /** The world was read whole (on the way in, or again after a gap): `open` is its `jobsOpen`. */
  entered(open: boolean): void;
  /** An event the mirror applied. `me` is your id once you're in. */
  heard(event: WorldEvent, me: string | undefined): void;
  /** The residents who ask for something today: the map and the 3D view put a note over each. */
  givers(): ReadonlySet<string>;
  /** Someone was tapped. True when they ask for something today, and their job's sheet opens. */
  tapped(who: { id: string; name: string }): boolean;
  /** You left the world: nothing is left showing. */
  reset(): void;
}

const NOBODY: ReadonlySet<string> = new Set();

export function worldJobs(o: {
  /** Say a line as one of the world's own notices. */
  toast: (line: string) => void;
  /** How to draw a giver, from the mirror. */
  person: GiverPerson;
}): WorldJobs {
  const label = h("span");
  const chip = h(
    "button",
    { class: "pill-button world-job", attrs: { type: "button", id: "world-job", hidden: true } },
    icon("town"),
    label,
  );

  let open = false;
  let board: JobsResponse | undefined;
  let noted: ReadonlySet<string> = NOBODY;
  /** Each read's turn, so an older answer never lands over a newer one. */
  let turn = 0;

  /** Who asked and what for, by job id: today's board and the job held from an earlier day. */
  const asked = (id: string): JobAsked | undefined =>
    board?.you?.held?.job === id ? board.you.held : board?.jobs.find((job) => job.id === id);

  function keep(next: JobsResponse | undefined) {
    board = next?.open ? next : undefined;
    noted = new Set((board?.jobs ?? []).flatMap((job) => (job.from.id ? [job.from.id] : [])));
    const held = board?.you?.held;
    chip.hidden = !held;
    if (!held) return;
    // First in the column of things to do where you stand, above Fish and Gather all. It joins
    // the page the first time there's a job to show.
    if (!chip.isConnected) document.querySelector(".world-near")?.prepend(chip);
    label.textContent = chipLabel(held);
    chip.setAttribute("aria-label", `Your job: ${held.title}. ${chipLabel(held)}`);
  }

  async function read() {
    const mine = ++turn;
    const r = await jobsApi.jobs();
    if (mine !== turn || !open) return;
    if (r.ok) keep(r.data);
  }

  const sheet = (giver?: { id: string; name: string }) => {
    const now = board;
    if (!now) return;
    void import("./job-sheet").then((m) =>
      m.openJobSheet({
        board: now,
        ...(giver ? { giver } : {}),
        person: o.person,
        read: (next) => {
          turn++;
          keep(next);
        },
      }),
    );
  };
  chip.addEventListener("click", () => sheet());

  return {
    entered(isOpen) {
      open = isOpen;
      if (open) void read();
      else keep(undefined);
    },
    heard(event, me) {
      if (event.type === "jobs_opened") open = true;
      if (!open) return;
      if (event.type === "jobs_opened" || event.type === "day_started") return void read();
      if (
        event.type !== "job_taken" &&
        event.type !== "job_progress" &&
        event.type !== "job_done" &&
        event.type !== "job_dropped"
      ) {
        return;
      }
      if (event.residentId !== me) return;
      const job = asked(event.job);
      if (event.type === "job_progress") {
        o.toast(progressLine(event, job));
        // The chip counts up at once; the read below brings the rest.
        const held = board?.you?.held;
        if (board?.you && held?.job === event.job) {
          keep({ ...board, you: { ...board.you, held: { ...held, count: event.count } } });
        }
      } else if (event.type === "job_done") {
        o.toast(doneLine(event, job?.from, board?.rules.perWeek));
      } else if (event.type === "job_dropped") {
        o.toast(droppedLine(event.lapsed === true));
      }
      void read();
    },
    givers: () => noted,
    tapped(who) {
      if (!noted.has(who.id)) return false;
      sheet(who);
      return true;
    },
    reset() {
      open = false;
      turn++;
      keep(undefined);
    },
  };
}
