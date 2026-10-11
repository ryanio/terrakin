/**
 * The pieces of the town's jobs (RFC 0030) that more than one place draws: a board row with its
 * Take button, and the job you hold with its bar, Hand in, and Let go. The Town Hall's Jobs section
 * and the job sheet in the world both build from these. Every word is the server's or `jobs.ts`'s;
 * the buttons send `take_job`, `hand_in`, and `drop_job`, and a refusal shows in the server's words.
 */
import type { HeldJobView, JobGiverView, JobView } from "@terrakin/protocol";
import { skillName } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { avatarEl, avatarPlaceholder, type Person } from "@terrakin/ui/people";
import { confirmTwice, itemRow, kindPill, progressBar, whileBusy } from "@terrakin/ui/ui";
import { actProblem, worldApi } from "./api/world";
import {
  askedLine,
  heldBar,
  heldLine,
  heldMoves,
  type JobStanding,
  jobRowAction,
  keptLine,
} from "./jobs";

/** The parts that are there: a card lists some of its lines only some of the time. */
export const present = (parts: readonly (Node | null)[]): Node[] =>
  parts.filter((part): part is Node => part !== null);

/** How to draw a giver who lives in this world, by resident id. Undefined: the town's own mark. */
export type GiverPerson = (id: string) => Person | undefined;

/** Who asks: the giver's avatar while that townsfolk lives here, else the town's mark. */
function giverMark(from: JobGiverView, person: GiverPerson): HTMLElement {
  const who = from.id === undefined ? undefined : person(from.id);
  if (who) return avatarEl(who, "sm");
  const mark = avatarPlaceholder("sm", "job-town");
  mark.append(icon("town"));
  return mark;
}

/** Who a job is for and the skill its points go to, on one line. */
const askedBy = (job: Pick<JobView, "from" | "skill">): HTMLElement =>
  h(
    "span",
    { class: "cluster job-asked" },
    h("span", { text: askedLine(job.from) }),
    kindPill(skillName(job.skill), "moss", "job-skill"),
  );

export interface JobActs {
  /** Something changed on the server: read the board again. */
  changed: () => void;
  /** The server said no, in its words. Empty clears it. */
  problem: (text: string) => void;
}

/**
 * One job on the board: the giver, the job's words, who it's for and its skill, and Take when the
 * server says one can be taken. The row for the job you hold says so in place of a button.
 */
export function jobRow(
  job: JobView,
  you: JobStanding | null,
  person: GiverPerson,
  acts: JobActs,
): HTMLLIElement {
  const action = jobRowAction(job, you);
  const take =
    action === "take"
      ? h("button", {
          class: "btn-primary small job-take",
          attrs: { type: "button", "aria-label": `Take the job: ${job.title}` },
          text: "Take",
        })
      : null;
  take?.addEventListener("click", async () => {
    acts.problem("");
    const r = await whileBusy(take, () => worldApi.act({ type: "take_job", job: job.id }));
    const why = actProblem(r);
    if (why) acts.problem(why);
    acts.changed();
  });
  return itemRow({
    plain: true,
    className: "job-row",
    attrs: { "data-job": job.id },
    lead: giverMark(job.from, person),
    name: job.title,
    lines: [askedBy(job)],
    trail: take ?? (action === "held" ? kindPill("Yours", "sun", "job-yours") : null),
  });
}

/**
 * The job you hold: its words, a bar, where it stands, how long it's kept, Hand in for a bring job
 * (a second tap, since the thing leaves your things for good), and Let go. `titled` leaves off the
 * "Your job" line over it, for a sheet whose title already says so.
 */
export function heldJob(
  held: HeldJobView,
  day: number | null,
  person: GiverPerson,
  acts: JobActs,
  titled = false,
): HTMLElement {
  const bar = heldBar(held);
  const kept = keptLine(held, day);
  const send = async (button: HTMLButtonElement, type: "hand_in" | "drop_job") => {
    acts.problem("");
    const r = await whileBusy(button, () => worldApi.act({ type }));
    const why = actProblem(r);
    if (why) acts.problem(why);
    acts.changed();
  };
  const buttons = heldMoves(held).map((move) => {
    if (move === "hand_in") {
      const button = h("button", {
        class: "btn-primary small job-hand-in",
        attrs: { type: "button" },
        text: "Hand in",
      });
      confirmTwice(button, "Hand it in for good?", () => send(button, "hand_in"));
      return button;
    }
    const button = h("button", {
      class: "pill-button small job-drop",
      attrs: { type: "button" },
      text: "Let go",
    });
    button.addEventListener("click", () => void send(button, "drop_job"));
    return button;
  });
  return h(
    "div",
    { class: "stack tight job-held", attrs: { "data-job": held.job } },
    titled ? null : h("p", { class: "eyebrow", text: "Your job" }),
    h(
      "div",
      { class: "cluster job-held-head" },
      giverMark(held.from, person),
      h(
        "div",
        { class: "job-held-words" },
        h("p", { class: "job-held-title", text: held.title }),
        askedBy(held),
      ),
    ),
    progressBar(bar.count, bar.total, bar.label),
    h("p", { class: "hint job-held-line", text: heldLine(held) }),
    kept ? h("p", { class: "hint", text: kept }) : null,
    h("div", { class: "cluster job-held-moves" }, ...buttons),
  );
}
