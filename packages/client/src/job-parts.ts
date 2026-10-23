/**
 * The pieces of the town's jobs (RFC 0030) that more than one place draws: a board row with its
 * Take button, and the job you hold with its bar, Hand in, and Let go. The Town Hall's Jobs section
 * and the job sheet in the world both build from these. Every word is the server's or `jobs.ts`'s.
 * The buttons send `take_job`, `hand_in`, and `drop_job` through one sender (`jobActs`), which
 * turns every job button off while one is out, says a refusal in the page's words, and reads the
 * board again either way.
 */
import type { Action, HeldJobView, JobFromView, JobView } from "@terrakin/protocol";
import { skillName } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { avatarEl, avatarPlaceholder } from "@terrakin/ui/people";
import { confirmTwice, itemRow, kindPill, progressBar, whileBusyAll } from "@terrakin/ui/ui";
import { actProblem, worldApi } from "./api/world";
import {
  askedLine,
  heldBar,
  heldJobLine,
  heldMoves,
  type JobStanding,
  jobProblem,
  jobRowAction,
  keptLine,
  shownProblem,
} from "./jobs";
import { failed } from "./page-data";

/** The parts that are there: a card lists some of its lines only some of the time. */
export const present = (parts: readonly (Node | null)[]): Node[] =>
  parts.filter((part): part is Node => part !== null);

/**
 * Who asks: the giver's avatar while that townsfolk lives here, from the server's author view of
 * them, so it's the picture the rest of the site shows for them, else the town's mark.
 */
function giverMark(from: JobFromView): HTMLElement {
  if (from.resident) return avatarEl(from.resident, "sm");
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

/** How a job button sends its action. */
export interface JobActs {
  /** `held` is the job a `hand_in` is for, so a refusal can name the thing it asks for. */
  send(pressed: HTMLButtonElement, action: Action, held?: Pick<HeldJobView, "bring">): void;
}

/**
 * The one sender for every job button in `within`. While an action is out every button there is
 * off, so a second Take can't go out beside the first. A refusal, or a request that didn't get
 * through, shows in `problem` and the buttons come back. Either way `reread` reads the board
 * again: it draws what changed and leaves the rest, and what it draws replaces the buttons.
 * `reread` resolves once that read's answer is drawn, or wasn't. Whoever draws a read calls
 * `problemAfterRead` first.
 */
export function jobActs(o: {
  within: HTMLElement;
  problem: HTMLElement;
  reread: () => Promise<void>;
}): JobActs {
  return {
    send(pressed, action, held) {
      void (async () => {
        const buttons = [...o.within.querySelectorAll<HTMLButtonElement>("button")];
        delete o.problem.dataset.unanswered;
        let unanswered = false;
        const r = await whileBusyAll(buttons, pressed, o.problem, async () => {
          const answer = await worldApi.act(action);
          unanswered = !answer.ok;
          const why = actProblem(answer, (code, message) =>
            jobProblem(code, message, held?.bring?.recipe),
          );
          return why === null ? answer : failed(why);
        });
        // `whileBusyAll` leaves "Saving…" up when it worked, for the repaint that follows.
        if (r.ok) o.problem.textContent = "";
        await o.reread();
        // A read that didn't come back draws nothing, so the buttons still on screen work again.
        for (const b of buttons) if (b.isConnected) b.disabled = false;
        // The line stays through this action's own read, and goes with the next one that lands.
        if (unanswered) o.problem.dataset.unanswered = "true";
      })();
    },
  };
}

/**
 * What the error line says once a read of the board has landed. A request that never got an answer
 * ("Can't reach Terrakin") is over, since this one did. A refusal stays until the next tap, unless
 * the board's own line now says the same sentence.
 */
export function problemAfterRead(problem: HTMLElement, you: JobStanding | null) {
  const over = problem.dataset.unanswered !== undefined;
  delete problem.dataset.unanswered;
  problem.textContent = over ? "" : shownProblem(problem.textContent ?? "", you);
}

/**
 * Draw `within` again without dropping keyboard focus to the page: a button that was focused is
 * gone once its row is redrawn (Take becomes "Yours"), so focus moves to `within` itself, which
 * the caller makes focusable. Never to a button drawn in its place: a second press of Enter after
 * Take would land on Let go.
 */
export function repaintKeepingFocus(within: HTMLElement, paint: () => void) {
  const had = within.contains(document.activeElement);
  paint();
  if (had && !within.contains(document.activeElement)) within.focus({ preventScroll: true });
}

/**
 * One job on the board: the giver, the job's words, who it's for and its skill, and Take when the
 * server says one can be taken. The row for the job you hold says so in place of a button.
 */
export function jobRow(job: JobView, you: JobStanding | null, acts: JobActs): HTMLLIElement {
  const action = jobRowAction(job, you);
  const take =
    action === "take"
      ? h("button", {
          class: "btn-primary small job-take",
          attrs: { type: "button", "aria-label": `Take the job: ${job.title}` },
          text: "Take",
        })
      : null;
  take?.addEventListener("click", () => acts.send(take, { type: "take_job", job: job.id }));
  return itemRow({
    plain: true,
    className: "job-row",
    attrs: { "data-job": job.id },
    lead: giverMark(job.from),
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
  acts: JobActs,
  titled = false,
): HTMLElement {
  const bar = heldBar(held);
  const kept = keptLine(held, day);
  const buttons = heldMoves(held).map((move) => {
    if (move === "hand_in") {
      const button = h("button", {
        class: "btn-primary small job-hand-in",
        attrs: { type: "button" },
        text: "Hand in",
      });
      // Name what goes for good, the thing `hand_in` would take now ("Hand in your smooth sea bowl
      // for good?"), as the server says it.
      const what = held.handIn
        ? `Hand in your ${held.handIn.name.charAt(0).toLowerCase()}${held.handIn.name.slice(1)} for good?`
        : "Hand it in for good?";
      confirmTwice(button, what, () => acts.send(button, { type: "hand_in" }, held));
      return button;
    }
    const button = h("button", {
      class: "pill-button small job-drop",
      attrs: { type: "button" },
      text: "Let go",
    });
    button.addEventListener("click", () => acts.send(button, { type: "drop_job" }));
    return button;
  });
  return h(
    "div",
    { class: "stack tight job-held", attrs: { "data-job": held.job } },
    titled ? null : h("p", { class: "eyebrow", text: "Your job" }),
    h(
      "div",
      { class: "cluster job-held-head" },
      giverMark(held.from),
      h(
        "div",
        { class: "job-held-words" },
        h("p", { class: "job-held-title", text: held.title }),
        askedBy(held),
      ),
    ),
    progressBar(bar.count, bar.total, bar.label),
    h("p", { class: "hint job-held-line", text: heldJobLine(held) }),
    kept ? h("p", { class: "hint", text: kept }) : null,
    h("div", { class: "cluster job-held-moves" }, ...buttons),
  );
}
