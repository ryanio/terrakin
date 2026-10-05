import {
  type AuthorView,
  COIN_RULES,
  type PublicGift,
  type PurseLine,
  type PurseResponse,
  type TreasuryView,
} from "@terrakin/protocol";
import { type LedgerLine, purseOf, treasuryOf, type WorldState } from "@terrakin/sim";

/**
 * Coins (RFC 0008) as the API shows them. The sim keeps the ledgers; this adds names. A purse is
 * private to its owner. The treasury is public, and so is who gave whom a gift, but never how much
 * or the note.
 */

type Authors = (id: string) => AuthorView | undefined;

/** How many recent gifts the treasury view lists. */
export const PUBLIC_GIFTS = 10;

function purseLine(line: LedgerLine, author: Authors): PurseLine {
  const other = line.with === undefined ? undefined : author(line.with);
  return {
    seq: line.seq,
    day: line.day,
    amount: line.amount,
    reason: line.reason,
    ...(other ? { with: other } : {}),
    ...(line.note ? { note: line.note } : {}),
    trust: "untrusted",
  };
}

/** `GET /v1/purse`: the viewer's own purse, newest line first. */
export function purseView(state: WorldState, viewer: string, author: Authors): PurseResponse {
  const purse = purseOf(state, viewer);
  if (!purse) return { purse: null, rules: { ...COIN_RULES } };
  return {
    purse: {
      balance: purse.balance,
      ledger: purse.ledger.map((l) => purseLine(l, author)).reverse(),
      streak: purse.streak,
      allowanceToday: purse.allowanceToday,
      hasHearth: state.residents[viewer]?.hearth != null,
      givenToday: purse.givenToday,
      receivedToday: purse.receivedToday,
      firstDay: purse.firstDay,
    },
    rules: { ...COIN_RULES },
  };
}

/** The purse lines from today, newest first, for a check-in. */
export function todaysLines(state: WorldState, viewer: string, author: Authors) {
  const purse = purseOf(state, viewer);
  if (!purse) return null;
  const today = state.day ?? 0;
  return {
    balance: purse.balance,
    allowanceToday: purse.allowanceToday,
    today: purse.ledger
      .filter((l) => l.day === today)
      .map((l) => purseLine(l, author))
      .reverse(),
  };
}

/**
 * Recent gifts between residents, read from the givers' ledgers: who, to whom, and when. Never the
 * amount or the note, and never anyone the author lookup hides (suspended, gone).
 */
export function recentGifts(
  state: WorldState,
  author: Authors,
  limit = PUBLIC_GIFTS,
): PublicGift[] {
  const gifts: { seq: number; day: number; from: string; to: string }[] = [];
  for (const [id, lines] of Object.entries(state.economy?.ledgers ?? {})) {
    for (const l of lines) {
      if (l.reason === "gift_out" && l.with !== undefined) {
        gifts.push({ seq: l.seq, day: l.day, from: id, to: l.with });
      }
    }
  }
  gifts.sort((a, b) => b.seq - a.seq);
  const out: PublicGift[] = [];
  for (const g of gifts) {
    const from = author(g.from);
    const to = author(g.to);
    if (from && to) out.push({ seq: g.seq, day: g.day, from, to });
    if (out.length >= limit) break;
  }
  return out;
}

/** The town's purse for `GET /v1/town`, newest line first, or null before coins open. */
export function treasuryView(state: WorldState, author: Authors): TreasuryView | null {
  const t = treasuryOf(state);
  if (!t) return null;
  return {
    balance: t.balance,
    minted: t.minted,
    burned: t.burned,
    ledger: t.ledger
      .map((l) => {
        const resident = l.with === undefined ? undefined : author(l.with);
        return {
          seq: l.seq,
          day: l.day,
          amount: l.amount,
          reason: l.reason,
          ...(resident ? { resident } : {}),
        };
      })
      .reverse(),
    gifts: recentGifts(state, author),
  };
}
