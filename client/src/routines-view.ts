/**
 * Routines (RFC 0009) on the web: the sheet on your own profile that turns them on and off, the
 * away list it shows, and the "While you were away" card on the home wall. Hours are picked in
 * your own time and sent as the UTC hour the server keeps. Every line's words come from the
 * server's routine and code; the one name is a neighbor's own, put in as text.
 */
import {
  type AwayLine,
  ROUTINE_RULES,
  type RoutineChoice,
  type RoutinesResponse,
} from "@terrakin/protocol";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import {
  checkRow,
  errorLine,
  itemRow,
  itemRows,
  moreButton,
  openOverlay,
  sheet,
} from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { actFromButton } from "./act";
import { api } from "./api";

/** What one away log line says, in plain words, and the mark beside it. */
export interface AwayWords {
  icon: IconName;
  name: string;
  /** The fix for a refusal, or why routines paused. */
  line: string | null;
}

/** How a routine reads after "Your". */
const ROUTINE_NAMES: Record<string, string> = {
  walk_home: "walk home",
  stroll: "stroll",
  greet: "wave",
};

/** An away log line in plain words: what happened, from its routine and result alone. */
export function awayWords(l: AwayLine): AwayWords {
  if (l.result === "paused")
    return { icon: "moon", name: "Your routines paused", line: l.reason ?? null };
  if (l.result === "refused") {
    const days = l.days ? ` (${l.days} days in a row)` : "";
    return {
      icon: "close",
      name: `Your ${ROUTINE_NAMES[l.routine ?? ""] ?? "routine"} couldn't run${days}`,
      line: l.reason ?? null,
    };
  }
  if (l.routine === "walk_home") return { icon: "home", name: "Walked home", line: null };
  if (l.routine === "stroll")
    return { icon: "sprout", name: "Strolled around your plot", line: null };
  return { icon: "smile", name: `Waved at ${l.to?.name ?? "a neighbor"}`, line: null };
}

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

/** One away log line as a row: what happened, when, and the fix for a refusal. */
function awayRow(l: AwayLine): HTMLLIElement {
  const words = awayWords(l);
  return itemRow({
    lead: icon(words.icon, `icon away-mark ${l.result}`),
    name: words.name,
    lines: [timeAgo(l.at), words.line],
    plain: true,
    className: `away-row ${l.result}`,
  });
}

/** The away list, newest first. */
function awayList(lines: readonly AwayLine[]): HTMLElement {
  return itemRows(lines.map(awayRow), { ordered: true, className: "away-list" });
}

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
      class: "purse-hint",
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
          class: "purse-hint",
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

/** Lines this recent show on the home wall. */
const AWAY_CARD_HOURS = 24;
/** At most this many of them. */
const AWAY_CARD_LINES = 4;

/**
 * "While you were away" for the home wall: what your routines did in the last day, with a way to
 * the sheet. Null when there's nothing to show, so the wall stays as it was.
 */
export async function awayCard(): Promise<HTMLElement | null> {
  const r = await api.routines();
  if (!r.ok) return null;
  const since = Date.now() - AWAY_CARD_HOURS * 3_600_000;
  const recent = r.data.away.items
    .filter((l) => Date.parse(l.at) >= since)
    .slice(0, AWAY_CARD_LINES);
  if (recent.length === 0) return null;
  const open = h(
    "button",
    { class: "pill-button small away-open", attrs: { type: "button" } },
    icon("moon"),
    h("span", { text: "Routines" }),
  );
  open.addEventListener("click", () => void openRoutines(open));
  return h(
    "section",
    {
      class: "paper card stack away-card",
      attrs: { id: "away-card", "aria-labelledby": "away-title" },
    },
    h("h2", { class: "away-title", attrs: { id: "away-title" }, text: "While you were away" }),
    awayList(recent),
    h("div", { class: "cluster" }, open),
  );
}
