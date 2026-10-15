import { describe, expect, it } from "vitest";
import { foundingLine, gatheredLine, inviteOpenLine, memberLine, summaryLine } from "./kindreds";

/** The kindred page's and the Town Hall's words (RFC 0033). */
describe("kindred words", () => {
  it("say how a kindred has gathered, and a run only once it's more than one week", () => {
    expect(gatheredLine(0, 0)).toBe("Hasn't gathered yet");
    expect(gatheredLine(1, 1)).toBe("Gathered 1 week");
    expect(gatheredLine(5, 3)).toBe("Gathered 5 weeks, 3 in a row");
    expect(summaryLine({ members: 1, gathered: 2, run: 0 })).toBe("1 member · Gathered 2 weeks");
  });

  it("put days in human words, never a world day's number", () => {
    const today = 20_740;
    expect(inviteOpenLine(today + 1, today)).toBe("Lapses tomorrow");
    expect(inviteOpenLine(today + 7, today)).toBe("Lapses in 7 days");
    expect(memberLine({ steward: true, since: 20_700 }, true, today)).toBe("Steward · Founded it");
    expect(memberLine({ steward: false, since: today }, false, today)).toBe("Joined today");
    expect(memberLine({ steward: false, since: today - 3 }, false, today)).toBe(
      "Joined 3 days ago",
    );
  });
});

describe("founding against your coins (issue #69)", () => {
  const rules = { fee: 25, trialBurn: 5, formDays: 14, allowance: 10 };
  it("says the cost, your coins, the days to the rest, and what comes back", () => {
    expect(foundingLine(rules, 8)).toBe(
      "Founding takes 25 coins, and you have 8. Your allowance at your hearth, 10 a day, gets you there in about 2 days. If it doesn't form within 14 days, all but 5 come back, and members can chip in toward it while it forms.",
    );
    expect(foundingLine(rules, 20)).toContain("about 1 day.");
    expect(foundingLine(rules, 40)).not.toContain("allowance");
  });
});
