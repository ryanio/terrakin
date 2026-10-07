/**
 * "Getting started" on the home wall, for a signed-in person with first steps left: a bar for how
 * far along they are, each step left as a row that links to where it's done, and the done ones
 * folded away behind "Show 9 done". It goes away when every step is done, or for good on this
 * device once hidden. Loaded only for someone signed in, so the wall's first load leaves it out.
 */
import { h, icon } from "@terrakin/ui/dom";
import {
  announce,
  cardBar,
  closeButton,
  disclosure,
  itemRow,
  itemRows,
  progressBar,
} from "@terrakin/ui/ui";
import { api } from "./api";
import { doneLine, nextStep, type StepRow, stepHref, stepRows } from "./first-steps";

/** The resident this device hid the card for. */
const HIDDEN_KEY = "terrakin.firstStepsHidden";

function hiddenFor(me: string): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === me;
  } catch {
    return false;
  }
}

function hide(me: string) {
  try {
    localStorage.setItem(HIDDEN_KEY, me);
  } catch {
    // Storage off: the card comes back next time, which is all that's lost.
  }
}

/** A done step: a tick and its name, one short line. */
function doneRow(row: StepRow): HTMLLIElement {
  return itemRow({
    lead: icon("check", "icon first-step-mark"),
    name: row.name,
    plain: true,
    className: "first-step done",
    attrs: { "data-step": row.id },
  });
}

/**
 * A step left: its own framed row with its hint, and a verb that links to where it's done. The
 * link covers the whole row, so any tap on it goes there.
 */
function stepRow(row: StepRow, me: string): HTMLLIElement {
  // The home wall is where you are, so a step done here gets no link.
  const go =
    row.place === "wall"
      ? null
      : h(
          "a",
          {
            class: "first-step-go",
            attrs: { href: stepHref(row.place, me), "aria-label": row.name },
          },
          h("span", { text: row.verb }),
          icon("arrow", "icon first-step-arrow"),
        );
  return itemRow({
    lead: icon(row.icon, "icon first-step-mark"),
    name: row.name,
    lines: [row.hint],
    trail: go,
    className: go ? "first-step linked" : "first-step",
    attrs: { "data-step": row.id },
  });
}

/** The card for `me`, or null when every step is done, the card was hidden, or the read failed. */
export async function firstStepsCard(me: string): Promise<HTMLElement | null> {
  if (hiddenFor(me)) return null;
  const r = await api.firstVisit();
  if (!r.ok) return null;
  const rows = stepRows(r.data);
  if (!nextStep(rows)) return null;
  const left = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);
  const card = h(
    "section",
    {
      class: "paper card stack first-steps-card",
      attrs: { id: "first-steps", "aria-labelledby": "first-steps-title" },
    },
    cardBar(
      "Getting started",
      closeButton("Hide getting started", () => {
        hide(me);
        card.remove();
        announce("Getting started is hidden on this device.");
      }),
    ),
    h("h2", { class: "card-title", attrs: { id: "first-steps-title" }, text: "Your first steps" }),
    h(
      "div",
      { class: "first-steps-progress" },
      h("p", { class: "hint", text: doneLine(rows) }),
      progressBar(done.length, rows.length, "Steps done"),
    ),
    itemRows(
      left.map((row) => stepRow(row, me)),
      { ordered: true, className: "first-steps" },
    ),
    done.length > 0 ? doneSteps(done) : null,
  );
  return card;
}

/** The done steps, folded behind "Show 9 done" so the ones left lead the card. */
function doneSteps(done: readonly StepRow[]): HTMLElement {
  const list = itemRows(done.map(doneRow), { className: "first-steps done-steps" });
  list.id = "first-steps-done";
  list.hidden = true;
  const label = h("span", {});
  const toggle = h(
    "button",
    { class: "text-button quiet first-steps-more", attrs: { type: "button" } },
    label,
    icon("chevronDown", "icon first-steps-chevron"),
  );
  disclosure(toggle, list, undefined, (open) => {
    label.textContent = open ? "Hide done" : `Show ${done.length} done`;
  });
  label.textContent = `Show ${done.length} done`;
  return h("div", { class: "stack tight" }, toggle, list);
}
