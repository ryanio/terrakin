import type { AuthorView, PurseLine, PurseView, TreasuryView } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { coinNews } from "./pulse";
import { allowanceWaiting, coinNote, coins, linesAfter } from "./purse";
import { lineLabel, signed } from "./purse-view";

const ash = { id: "r_ash", name: "Ash", kind: "agent" } as AuthorView;
const wren = { id: "r_wren", name: "Wren", kind: "human" } as AuthorView;

const line = (over: Partial<PurseLine>): PurseLine => ({
  seq: 1,
  day: 20_000,
  amount: 10,
  reason: "allowance",
  trust: "untrusted",
  ...over,
});

describe("coin notices", () => {
  it("say what came in, in plain words, and never say token", () => {
    expect(coins(1)).toBe("1 coin");
    expect(coins(1200)).toBe("1,200 coins");
    expect(coinNote(line({ amount: 10, reason: "allowance" }))).toEqual({
      lead: "+10 coins",
      rest: "for coming home today",
    });
    expect(coinNote(line({ amount: 50, reason: "welcome" }))?.rest).toContain("first plot");
    const gift = coinNote(line({ amount: 5, reason: "gift_in", with: ash, note: "for the tea" }));
    expect(gift).toMatchObject({ lead: "Ash", rest: "gave you 5 coins", snippet: "for the tea" });
    for (const reason of ["allowance", "streak", "welcome", "gift_in"] as const) {
      const n = coinNote(line({ reason, with: ash }));
      expect(JSON.stringify(n).toLowerCase()).not.toContain("token");
    }
  });

  it("say what the town paid for what you sold", () => {
    expect(coinNote(line({ amount: 5, reason: "sold" }))).toEqual({
      lead: "+5 coins",
      rest: "from the town for what you sold",
    });
  });

  it("stay quiet about coins going out and about townsfolk budgets", () => {
    expect(coinNote(line({ amount: -5, reason: "gift_out", with: wren }))).toBeNull();
    expect(coinNote(line({ amount: -40, reason: "shop" }))).toBeNull();
    expect(coinNote(line({ amount: 50, reason: "budget" }))).toBeNull();
  });

  it("pick only the lines newer than the last look, oldest first", () => {
    const ledger = [line({ seq: 9 }), line({ seq: 7 }), line({ seq: 4 })];
    expect(linesAfter(ledger, 5).map((l) => l.seq)).toEqual([7, 9]);
    expect(linesAfter(ledger, 9)).toEqual([]);
  });
});

describe("the purse in the top bar", () => {
  const purse = (over: Partial<PurseView>): PurseView => ({
    balance: 40,
    ledger: [],
    streak: 0,
    allowanceToday: false,
    hasHearth: true,
    givenToday: 0,
    receivedToday: 0,
    firstDay: false,
    ...over,
  });

  it("says today's coins are waiting only when they're due and there's a hearth", () => {
    expect(allowanceWaiting(purse({}))).toBe(true);
    expect(allowanceWaiting(purse({ allowanceToday: true }))).toBe(false);
    expect(allowanceWaiting(purse({ hasHearth: false }))).toBe(false);
  });

  it("never says so to townsfolk, who get a budget instead of the allowance", () => {
    expect(allowanceWaiting(purse({ allowanceEligible: false }))).toBe(false);
  });
});

describe("the purse page", () => {
  it("labels each line and signs each amount", () => {
    expect(lineLabel({ reason: "gift_in", with: ash })).toBe("A gift from Ash");
    expect(lineLabel({ reason: "gift_out", with: wren })).toBe("Your gift to Wren");
    expect(lineLabel({ reason: "welcome" })).toContain("first plot");
    expect(lineLabel({ reason: "shop" })).toBe("At the town shop");
    expect(lineLabel({ reason: "sold" })).toBe("Sold to the town");
    expect(lineLabel({ reason: "appreciation" })).toBe("Neighbors who liked your posts");
    expect(lineLabel({ reason: "event_deposit" })).toBe("Deposit for your Commons event");
    expect(lineLabel({ reason: "event_refund" })).toBe("Your Commons deposit back");
    expect(signed(10)).toBe("+10");
    expect(signed(-1500)).toBe("−1,500");
  });
});

describe("coin news for Happening now", () => {
  const treasury = (over: Partial<TreasuryView>): TreasuryView => ({
    balance: 5000,
    minted: 5000,
    burned: 0,
    ledger: [],
    gifts: [],
    ...over,
  });

  it("finds new gifts, welcome gifts, and the day's mint, oldest first", () => {
    const before = treasury({
      ledger: [{ seq: 3, day: 1, amount: 5000, reason: "opening" }],
      gifts: [{ seq: 4, day: 1, from: ash, to: wren }],
    });
    const after = treasury({
      ledger: [
        { seq: 9, day: 2, amount: 700, reason: "mint" },
        { seq: 8, day: 1, amount: -50, reason: "welcome", resident: wren },
        { seq: 7, day: 1, amount: -50, reason: "budget", resident: ash },
        { seq: 3, day: 1, amount: 5000, reason: "opening" },
      ],
      gifts: [
        { seq: 6, day: 1, from: wren, to: ash },
        { seq: 4, day: 1, from: ash, to: wren },
      ],
    });
    const news = coinNews(before, after);
    expect(news.map((n) => n.kind)).toEqual(["gift", "welcome", "mint"]);
    // A gift says who and whom, never how much.
    expect(news[0]).toEqual({ kind: "gift", gift: { seq: 6, day: 1, from: wren, to: ash } });
  });

  it("has nothing to say before coins open or on the first look", () => {
    expect(coinNews(null, treasury({}))).toEqual([]);
    expect(coinNews(treasury({}), null)).toEqual([]);
  });
});
