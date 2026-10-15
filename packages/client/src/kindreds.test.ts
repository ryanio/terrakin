import { describe, expect, it } from "vitest";
import { gatheredLine, inviteOpenLine, memberLine, summaryLine } from "./kindreds";

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
