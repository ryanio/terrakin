/**
 * The purse in the top bar (RFC 0008): your coins, private to you. It asks the server on page
 * changes (at most every 15 seconds), once a minute while the page is visible, and right after
 * you give coins. When the balance goes up it counts up with a glow, and what came in shows as a
 * live notice. Names and gift notes are other residents' text, so they only go in as text.
 */
import type { PurseLine, PurseResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount } from "@terrakin/ui/format";
import { api } from "./api";
import { liveToast, snippet } from "./live-toast";
import { savedResidentId, savedToken } from "./net";

const POLL_MS = 60_000;
const MIN_GAP_MS = 15_000;
const COUNT_MS = 700;
const GLOW_MS = 1_600;
/** At most this many notices for one refresh, so a long absence doesn't flood the screen. */
const NOTICES_MAX = 3;

/** "1 coin", "12 coins". Players see coins, never tokens. */
export const coins = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "coin" : "coins"}`;

/** What a purse line says as a live notice, or null for lines that don't get one. */
export function coinNote(
  line: PurseLine,
): { lead: string; rest: string; snippet?: string; from?: PurseLine["with"] } | null {
  if (line.amount <= 0) return null;
  switch (line.reason) {
    case "allowance":
      return { lead: `+${coins(line.amount)}`, rest: "for coming home today" };
    case "streak":
      return { lead: `+${coins(line.amount)}`, rest: "for coming home days in a row" };
    case "welcome":
      return { lead: `+${coins(line.amount)}`, rest: "to welcome you to your first plot" };
    case "gift_in":
      return {
        lead: line.with?.name ?? "Someone",
        rest: `gave you ${coins(line.amount)}`,
        ...(line.note ? { snippet: snippet(line.note) } : {}),
        ...(line.with ? { from: line.with } : {}),
      };
    default:
      return null;
  }
}

/** Lines newer than `seq`, oldest first. */
export function linesAfter(ledger: readonly PurseLine[], seq: number): PurseLine[] {
  return ledger.filter((l) => l.seq > seq).sort((a, b) => a.seq - b.seq);
}

let pill: HTMLAnchorElement | undefined;
let amount: HTMLElement | undefined;
let label: HTMLElement | undefined;
let shown = 0;
let lastSeq: number | undefined;
let lastAsked = 0;
let asking = false;
/** A forced refresh asked for while another was in flight: run it when that one lands. */
let again = false;
let counting = 0;

/**
 * The newest purse line this browser has announced, kept per resident, so a gift that came in
 * while you were away still gets its notice on your next visit. A convenience: without storage,
 * the first look just sets the mark quietly.
 */
const SEEN_KEY = "terrakin.purse.seen";

function readSeen(who: string): number | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "null") as {
      who?: string;
      seq?: number;
    } | null;
    return saved?.who === who && typeof saved.seq === "number" ? saved.seq : undefined;
  } catch {
    return undefined;
  }
}

function writeSeen(who: string, seq: number) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ who, seq }));
  } catch {
    // Private windows and blocked storage: notices just start from now next time.
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Count the number up from what's shown to `to`. */
function countTo(to: number) {
  const target = amount;
  if (!target) return;
  const from = shown;
  shown = to;
  cancelAnimationFrame(counting);
  if (to <= from || reducedMotion()) {
    target.textContent = compactCount(to);
    return;
  }
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / COUNT_MS);
    const eased = 1 - (1 - k) ** 3;
    target.textContent = compactCount(Math.round(from + (to - from) * eased));
    if (k < 1) counting = requestAnimationFrame(step);
  };
  counting = requestAnimationFrame(step);
}

function glow() {
  if (!pill || reducedMotion()) return;
  pill.classList.remove("glow");
  // Restart the animation when coins arrive twice in a row.
  void pill.offsetWidth;
  pill.classList.add("glow");
  const el = pill;
  setTimeout(() => el.classList.remove("glow"), GLOW_MS);
}

function paint(res: PurseResponse, announce: boolean) {
  if (!pill || !amount || !label) return;
  const purse = res.purse;
  pill.hidden = purse === null;
  if (!purse) return;
  const newest = purse.ledger.reduce((max, l) => Math.max(max, l.seq), 0);
  const who = savedResidentId();
  const seen = lastSeq ?? (who ? readSeen(who) : undefined);
  const fresh = seen === undefined ? [] : linesAfter(purse.ledger, seen);
  const rose = purse.balance > shown && lastSeq !== undefined;
  lastSeq = Math.max(seen ?? 0, newest);
  if (who) writeSeen(who, lastSeq);
  const waiting = !purse.allowanceToday && purse.hasHearth;
  label.textContent = `Your purse: ${coins(purse.balance)}${waiting ? ". Today's coins are waiting" : ""}`;
  pill.title = purse.allowanceToday
    ? `${coins(purse.balance)}. You've had today's coins for coming home.`
    : `${coins(purse.balance)}. Come home to your hearth for today's coins.`;
  pill.classList.toggle("due", waiting);
  if (rose) {
    countTo(purse.balance);
    glow();
  } else {
    shown = purse.balance;
    amount.textContent = compactCount(purse.balance);
  }
  if (!announce) return;
  for (const line of fresh.slice(-NOTICES_MAX)) {
    const note = coinNote(line);
    if (!note) continue;
    liveToast({
      people: note.from ? [note.from] : [],
      lead: note.lead,
      rest: note.rest,
      ...(note.snippet ? { snippet: note.snippet } : {}),
      tone: "coins",
    });
  }
}

/** A new purse pill for the top bar. Only one is live at a time: the newest. Hidden until coins open. */
export function makePurse(): HTMLAnchorElement {
  label = h("span", { class: "visually-hidden", text: "Your purse" });
  amount = h("span", { class: "purse-amount", attrs: { "aria-hidden": "true" }, text: "0" });
  shown = 0;
  lastSeq = undefined;
  pill = h(
    "a",
    {
      class: "pill-button small site-purse",
      attrs: { id: "site-purse", href: "/purse", "data-nav": "purse", hidden: true },
    },
    icon("coin", "icon purse-coin"),
    amount,
    label,
  );
  refreshPurse(true);
  return pill;
}

/** Ask for the purse if there's a token and it's time. `force` skips the 15 second gap. */
export function refreshPurse(force = false) {
  if (!pill || !savedToken()) return;
  if (asking) {
    if (force) again = true;
    return;
  }
  if (!force && Date.now() - lastAsked < MIN_GAP_MS) return;
  lastAsked = Date.now();
  asking = true;
  const target = pill;
  void api.purse().then((r) => {
    asking = false;
    if (r.ok && target === pill) paint(r.data, true);
    if (again) {
      again = false;
      refreshPurse(true);
    }
  });
}

export function initPurse() {
  setInterval(() => {
    if (document.visibilityState === "visible") refreshPurse(true);
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshPurse();
  });
}
