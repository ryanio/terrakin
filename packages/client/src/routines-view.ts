/**
 * Routines (RFC 0009) on the web: the sheet on your own profile that turns them on and off, with
 * the away list it shows (`away-card.ts`). Hours are picked in your own time and sent as the UTC
 * hour the server keeps.
 */
import { ROUTINE_RULES, type RoutineChoice, type RoutinesResponse } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { checkRow, errorLine, moreButton, openOverlay, sheet } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { awayList, awayRow } from "./away-card";

/** A UTC hour as the time it is where you are, like "7:00 PM", on the day of `on`. */
export function hourLabel(utcHour: number, on = new Date()): string {
  const at = new Date(on);
  at.setUTCHours(utcHour, 0, 0, 0);
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The UTC hour it is when it's `localHour` o'clock where you are (rounded down), on `on`'s day. */
export function utcHourAt(localHour: number, on = new Date()): number {
  const at = new Date(on);
  at.setHours(localHour, 0, 0, 0);
  return at.getUTCHours();
}

/** Where a routine you haven't set starts: the evening where you are. */
const LOCAL_EVENING = { walk_home: 18, stroll: 19 } as const;

/** The 24 UTC hours as choices, each shown in your own time. */
function hourPick(id: string, value: number): HTMLSelectElement {
  const pick = h(
    "select",
    { class: "field-input routine-hour", attrs: { id } },
    ...Array.from({ length: 24 }, (_, hour) =>
      h("option", { attrs: { value: String(hour) }, text: hourLabel(hour) }),
    ),
  );
  pick.value = String(value);
  return pick;
}

/** A routine's switch, its hint, and the choice under it (greyed out while it's off). */
function routineRow(
  kind: RoutineChoice["kind"],
  label: string,
  hint: string,
  on: boolean,
  choice: HTMLSelectElement,
  word: string,
) {
  const row = checkRow({ id: `routine-${kind}`, label, hint, checked: on });
  const sync = () => {
    choice.disabled = !row.input.checked;
  };
  row.input.addEventListener("change", sync);
  sync();
  const when = h(
    "label",
    { class: "routine-when", attrs: { for: choice.id } },
    h("span", { class: "routine-word", text: word }),
    choice,
  );
  return { el: h("div", { class: "routine" }, row.el, when), input: row.input };
}

/** The form that turns routines on and off. `saved` reloads the sheet. */
function routinesForm(data: RoutinesResponse, saved: () => Promise<void>): HTMLFormElement {
  const set = new Map(data.routines.map((r) => [r.kind, r]));
  const walkHome = set.get("walk_home");
  const stroll = set.get("stroll");
  const greet = set.get("greet");
  const walkAt = hourPick(
    "routine-walk_home-hour",
    walkHome?.kind === "walk_home" ? walkHome.hour : utcHourAt(LOCAL_EVENING.walk_home),
  );
  const strollAt = hourPick(
    "routine-stroll-hour",
    stroll?.kind === "stroll" ? stroll.hour : utcHourAt(LOCAL_EVENING.stroll),
  );
  const most = h(
    "select",
    { class: "field-input routine-max", attrs: { id: "routine-greet-max" } },
    ...Array.from({ length: ROUTINE_RULES.greetMostMax }, (_, i) =>
      h("option", { attrs: { value: String(i + 1) }, text: `${i + 1} a day` }),
    ),
  );
  most.value = String(greet?.kind === "greet" ? greet.max : ROUTINE_RULES.greetMax);
  const rows = {
    walk_home: routineRow(
      "walk_home",
      "Walk home",
      "Once a day, back to your hearth.",
      walkHome !== undefined,
      walkAt,
      "at",
    ),
    stroll: routineRow(
      "stroll",
      "Stroll around your plot",
      "A few minutes out, then home again.",
      stroll !== undefined,
      strollAt,
      "at",
    ),
    greet: routineRow(
      "greet",
      "Wave at neighbors",
      "At people who walk past your home.",
      greet !== undefined,
      most,
      "up to",
    ),
  };
  const save = h(
    "button",
    { class: "btn-primary", attrs: { type: "submit", id: "routines-save" } },
    "Save",
  );
  const form = h(
    "form",
    { class: "stack routines-form" },
    rows.walk_home.el,
    rows.stroll.el,
    rows.greet.el,
    h("p", {
      class: "hint",
      text: `Times are in your time zone. Routines run only while you're away, earn no coins, and pause after ${ROUTINE_RULES.pauseAfterDays} days without a visit. Pick times that aren't your real routine.`,
    }),
    save,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const routines: RoutineChoice[] = [];
    if (rows.walk_home.input.checked)
      routines.push({ kind: "walk_home", hour: Number(walkAt.value) });
    if (rows.stroll.input.checked) routines.push({ kind: "stroll", hour: Number(strollAt.value) });
    if (rows.greet.input.checked) routines.push({ kind: "greet", max: Number(most.value) });
    const done =
      routines.length > 0 ? "Saved. They'll run while you're away." : "Routines are off.";
    void actFromButton(save, { type: "set_routines", routines }, done, { after: saved });
  });
  return form;
}

/**
 * The Routines sheet: turn them on and off, and what they did lately, older lines a page at a time.
 * `returnTo` gets focus back when it closes.
 */
export async function openRoutines(returnTo?: HTMLElement): Promise<void> {
  const body = h("div", { class: "stack routines-body" });
  const { dialog } = sheet(
    {
      id: "routines-title",
      title: "While you're away",
      className: "routines-sheet",
      lede: "Your character keeps living here between your visits.",
    },
    body,
  );
  openOverlay(dialog, undefined, returnTo);
  const load = async () => {
    const r = await api.routines();
    if (!dialog.isConnected) return;
    if (!r.ok) {
      const problem = errorLine("routines-error");
      problem.textContent = r.message;
      body.replaceChildren(problem);
      return;
    }
    const data = r.data;
    const parts: HTMLElement[] = [routinesForm(data, load)];
    if (data.paused) {
      parts.unshift(
        h("p", {
          class: "hint",
          text: "Your routines are on hold while your account is paused.",
        }),
      );
    }
    if (data.away.items.length > 0) {
      const list = awayList(data.away.items);
      let next = data.away.next;
      const more = moreButton("Show older", async () => {
        if (!next) return undefined;
        const page = await api.routines(next);
        if (!page.ok) return page.message;
        list.append(...page.data.away.items.map(awayRow));
        next = page.data.away.next;
        more.el.hidden = next === null;
        return undefined;
      });
      more.el.hidden = next === null;
      parts.push(
        h("h3", { class: "section-title", text: "Lately" }),
        list,
        h("div", { class: "feed-foot" }, more.el),
      );
    }
    body.replaceChildren(...parts);
  };
  await load();
}
