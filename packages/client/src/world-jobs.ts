/**
 * The town's jobs in the world (RFC 0030): a chip while you hold one ("Job: 1 of 3", which opens
 * its sheet), a toast for each deed that moves it and for finishing it, in the same line as the
 * coins and things that deed brought, a note over each townsfolk who asks for something today, and
 * their job's sheet when you tap them. The board comes from `GET /v1/jobs`, read on the way in, at
 * each new day, and after each of your own job events, which the socket sends only to you; an open
 * sheet hears every one of those reads, so it never shows a job that was finished or let go
 * elsewhere. Nothing here runs until the world says jobs are open, and nothing decides: the words
 * are `jobs.ts`'s.
 */
import type { JobsResponse, WorldEvent } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { jobsApi } from "./api/jobs";
import type { GiverPerson } from "./job-parts";
import { chipLabel, doneLine, droppedLine, type JobAsked, newestOnly, progressLine } from "./jobs";

/** What a tap on someone does when it isn't their job's sheet that opens. */
interface GiverTap {
  /** What the tap did before jobs: when they ask for nothing today, or the sheet can't load. */
  otherwise: () => void;
  /**
   * Their lessons, where recipes are learned: resolves to a way to open the teach sheet, or to
   * undefined when neither of you has anything to teach the other. The job sheet offers it as a
   * row of its own, so what a townsfolk can teach stays one tap away on a day they're on the board.
   */
  lessons?: () => Promise<(() => void) | undefined>;
}

export interface WorldJobs {
  /** The world was read whole (on the way in, or again after a gap): `open` is its `jobsOpen`. */
  entered(open: boolean): void;
  /** An event the mirror applied. `me` is your id once you're in. */
  heard(event: WorldEvent, me: string | undefined): void;
  /** The residents who ask for something today: the map and the 3D view put a note over each. */
  givers(): ReadonlySet<string>;
  /**
   * Someone was tapped. True when they ask for something today: their job's sheet opens, or
   * `otherwise` runs when it can't. False, with nothing done, for anyone else.
   */
  tapped(who: { id: string; name: string }, tap: GiverTap): boolean;
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
  /** The open sheet, told each board as it's kept. */
  const following = new Set<(board: JobsResponse | undefined) => void>();

  /** Who asked and what for, by job id: today's board and the job held from an earlier day. */
  const asked = (id: string): JobAsked | undefined =>
    board?.you?.held?.job === id ? board.you.held : board?.jobs.find((job) => job.id === id);

  function keep(next: JobsResponse | undefined) {
    board = next?.open ? next : undefined;
    noted = new Set((board?.jobs ?? []).flatMap((job) => (job.from.id ? [job.from.id] : [])));
    const held = board?.you?.held;
    chip.hidden = !held;
    if (held) {
      // First in the column of things to do where you stand, above Fish and Gather all. It joins
      // the page the first time there's a job to show.
      if (!chip.isConnected) document.querySelector(".world-near")?.prepend(chip);
      label.textContent = chipLabel(held);
      chip.setAttribute("aria-label", `Your job: ${held.title}. ${chipLabel(held)}`);
    }
    for (const heard of [...following]) heard(board);
  }

  /** Read the board. An older read's answer never lands over a newer one's. */
  const read = newestOnly(
    () => jobsApi.jobs(),
    (r) => {
      if (open && r.ok) keep(r.data);
    },
  );

  function sheet(giver: { id: string; name: string } | undefined, tap: GiverTap) {
    void Promise.all([import("./job-sheet"), tap.lessons?.().catch(() => undefined)])
      .then(([m, lessons]) => {
        const opened =
          board !== undefined &&
          m.openJobSheet({
            board,
            ...(giver ? { giver } : {}),
            ...(lessons ? { lessons } : {}),
            person: o.person,
            reread: read,
            follow: (heard) => {
              following.add(heard);
              return () => following.delete(heard);
            },
          });
        if (!opened) tap.otherwise();
      })
      // The sheet's code didn't load: the tap does what it did before there were jobs.
      .catch(tap.otherwise);
  }
  chip.addEventListener("click", () =>
    sheet(undefined, {
      otherwise: () => o.toast("Your job didn't open. Try again in a moment."),
    }),
  );

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
        o.toast(doneLine(event, job?.from));
      } else if (event.type === "job_dropped") {
        o.toast(droppedLine(event.lapsed === true));
      }
      void read();
    },
    givers: () => noted,
    tapped(who, tap) {
      if (!noted.has(who.id)) return false;
      sheet(who, tap);
      return true;
    },
    reset() {
      open = false;
      keep(undefined);
    },
  };
}
