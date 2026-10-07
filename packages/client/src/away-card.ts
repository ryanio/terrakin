/**
 * What routines (RFC 0009) did while you were away: the "While you were away" card on the home
 * wall, and the away list it shares with the Routines sheet (`routines-view.ts`), which loads only
 * when someone opens it. Every line's words come from the server's routine and code; the one name
 * is a neighbor's own, put in as text.
 */
import type { AwayLine } from "@terrakin/protocol";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import { itemRow, itemRows } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
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

/** One away log line as a row: what happened, when, and the fix for a refusal. */
export function awayRow(l: AwayLine): HTMLLIElement {
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
export function awayList(lines: readonly AwayLine[]): HTMLElement {
  return itemRows(lines.map(awayRow), { ordered: true, className: "away-list" });
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
  // The sheet is only for those who open it, so it loads then.
  open.addEventListener(
    "click",
    () => void import("./routines-view").then((m) => m.openRoutines(open)),
  );
  return h(
    "section",
    {
      class: "paper card stack away-card",
      attrs: { id: "away-card", "aria-labelledby": "away-title" },
    },
    h("h2", { class: "card-title", attrs: { id: "away-title" }, text: "While you were away" }),
    awayList(recent),
    h("div", { class: "cluster" }, open),
  );
}
