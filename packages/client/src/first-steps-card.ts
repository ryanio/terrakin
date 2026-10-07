/**
 * "Getting started" on the home wall, for a signed-in person with first steps left: each step in
 * plain words with a link to where it's done, ticked once the server says it's done. It goes away
 * when every step is done, or for good on this device once hidden. Loaded only for someone signed
 * in, so the wall's first load leaves it out.
 */
import { h, icon } from "@terrakin/ui/dom";
import { announce, cardBar, closeButton, itemRow, itemRows } from "@terrakin/ui/ui";
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

/** One step: ticked once done, else its hint and a link to where it's done. */
function stepRow(row: StepRow, me: string): HTMLLIElement {
  if (row.done) {
    return itemRow({
      lead: icon("check", "icon first-step-mark"),
      name: row.name,
      lines: ["Done"],
      plain: true,
      className: "first-step done",
      attrs: { "data-step": row.id },
    });
  }
  // The home wall is where you are, so a step done here gets no link.
  const go =
    row.place === "wall"
      ? null
      : h(
          "a",
          {
            class: "pill-button small",
            attrs: { href: stepHref(row.place, me), "aria-label": row.name },
          },
          h("span", { text: "Go" }),
          icon("arrow"),
        );
  return itemRow({
    lead: icon(row.icon, "icon first-step-mark"),
    name: row.name,
    lines: [row.hint],
    trail: go,
    plain: true,
    className: "first-step",
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
    h("p", { class: "hint", text: doneLine(rows) }),
    itemRows(
      rows.map((row) => stepRow(row, me)),
      { ordered: true, className: "first-steps" },
    ),
  );
  return card;
}
