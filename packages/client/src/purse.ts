/**
 * The purse in the top bar (RFC 0008): your coins, private to you. It asks the server on page
 * changes (at most every 15 seconds), once a minute while the page is visible, and right after
 * you give coins. When the balance goes up it counts up with a glow, and what came in shows as a
 * live notice. Names and gift notes are other residents' text, so they only go in as text.
 */
import type { PurseLine, PurseResponse, PurseView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount, formatCount, pluralWord } from "@terrakin/ui/format";
import { countTo, reducedMotion, replay, showNumber } from "@terrakin/ui/motion";
import { visiblePoll } from "@terrakin/ui/poll";
import { api } from "./api";
import { liveToast, snippet } from "./live-toast";
import { savedResidentId, savedToken } from "./net";

const COUNT_MS = 700;
const GLOW_MS = 1_600;
/** At most this many notices for one refresh, so a long absence doesn't flood the screen. */
const NOTICES_MAX = 3;

/** "1 coin", "12 coins". Players see coins, never tokens. */
export const coins = (n: number) => `${formatCount(n)} ${pluralWord(n, "coin", "coins")}`;

/** A balance, large, with the coin mark: the purse page and the shop. */
export function balanceLine(balance: number, id: string): HTMLElement {
  return h(
    "p",
    { class: "purse-balance", attrs: { id } },
    icon("coin", "icon purse-balance-coin"),
    h("span", { class: "purse-balance-amount", text: compactCount(balance) }),
    h("span", { class: "purse-balance-unit", text: pluralWord(balance, "coin", "coins") }),
  );
}

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
    case "sold":
      return { lead: `+${coins(line.amount)}`, rest: "from the town for what you sold" };
    case "appreciation":
      return { lead: `+${coins(line.amount)}`, rest: "from neighbors who liked your posts" };
    case "bounty":
      return { lead: `+${coins(line.amount)}`, rest: "for a bounty you finished" };
    case "grant":
      return { lead: `+${coins(line.amount)}`, rest: "from a Town Hall grant" };
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

/**
 * Whether today's allowance waits at home: it's due and there's a hearth to come home to. Never
 * for townsfolk, who get a daily budget instead.
 */
export const allowanceWaiting = (purse: PurseView) =>
  purse.allowanceEligible !== false && !purse.allowanceToday && purse.hasHearth;

/** Lines newer than `seq`, oldest first. */
export function linesAfter(ledger: readonly PurseLine[], seq: number): PurseLine[] {
  return ledger.filter((l) => l.seq > seq).sort((a, b) => a.seq - b.seq);
}

let pill: HTMLAnchorElement | undefined;
let amount: HTMLElement | undefined;
let label: HTMLElement | undefined;
let shown = 0;
let lastSeq: number | undefined;

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

function glow() {
  if (!pill || reducedMotion()) return;
  // Restart the animation when coins arrive twice in a row.
  replay(pill, "glow");
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
  const waiting = allowanceWaiting(purse);
  label.textContent = `Your purse: ${coins(purse.balance)}${waiting ? ". Today's coins are waiting" : ""}`;
  pill.title =
    purse.allowanceEligible === false
      ? coins(purse.balance)
      : purse.allowanceToday
        ? `${coins(purse.balance)}. You've had today's coins for coming home.`
        : `${coins(purse.balance)}. Come home to your hearth for today's coins.`;
  pill.classList.toggle("due", waiting);
  if (rose) {
    countTo(amount, purse.balance, COUNT_MS);
    glow();
  } else {
    showNumber(amount, purse.balance);
  }
  shown = purse.balance;
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

const poll = visiblePoll(
  async () => {
    const target = pill;
    const r = await api.purse();
    if (r.ok && target === pill) paint(r.data, true);
  },
  { everyMs: 60_000, minGapMs: 15_000, ready: () => Boolean(pill && savedToken()) },
);

/** Ask for the purse if there's a token and it's time. `force` skips the 15 second gap. */
export const refreshPurse = (force = false) => poll.refresh(force);

export const initPurse = poll.start;
