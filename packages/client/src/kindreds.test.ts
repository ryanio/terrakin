import { describe, expect, it } from "vitest";
import {
  foundingLine,
  gatheredLine,
  inviteLine,
  inviteOpenLine,
  inviteStandingLine,
  memberLine,
  summaryLine,
} from "./kindreds";

/** The kindred page's and the Town Hall's words (RFC 0033). */
describe("kindred words", () => {
  it("say how a kindred has gathered, and a run only once it's more than one week", () => {
    expect(gatheredLine(0, 0)).toBe("Hasn't gathered yet");
    expect(gatheredLine(1, 1)).toBe("Gathered 1 week");
    expect(gatheredLine(5, 3)).toBe("Gathered 5 weeks, 3 in a row");
    expect(summaryLine({ members: 1, gathered: 2, run: 0 })).toBe("1 member · Gathered 2 weeks");
  });

  it("put a member's days in human words, never a world day's number", () => {
    const today = 20_740;
    // An invite's words are the server's (`lapsesIn`), so only the prefix is this layer's.
    expect(inviteOpenLine({ lapsesIn: "in 7 days" })).toBe("Lapses in 7 days");
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

describe("what an invite says about the kindred (issue #73)", () => {
  const fern = { id: "r_1", name: "Fern" };
  const juniper = { id: "r_2", name: "Juniper" };

  it("names the founder beside the steward who invited you, and only once when they're one", () => {
    expect(inviteLine({ by: fern, founder: juniper, members: 4 })).toBe(
      "Fern invited you. Juniper founded it, and it has 4 members.",
    );
    expect(inviteLine({ by: fern, founder: fern, members: 1 })).toBe(
      "Fern founded this kindred and invited you. Now it has 1 member.",
    );
  });

  it("says a forming kindred's deadline, and a formed one's hall", () => {
    expect(
      inviteStandingLine(
        { status: "forming", hall: null, formsIn: "in 9 days" },
        {
          formHouseholds: 3,
        },
      ),
    ).toBe(
      "Still forming: it needs members from 3 households in 9 days, or it disbands and the fee goes back.",
    );
    expect(
      inviteStandingLine(
        { status: "formed", hall: { px: 4, py: 2 }, formsIn: null },
        {
          formHouseholds: 3,
        },
      ),
    ).toBe("Formed. Its hall is plot 4, 2.");
    expect(
      inviteStandingLine({ status: "formed", hall: null, formsIn: null }, { formHouseholds: 3 }),
    ).toBe("Formed. No hall yet.");
  });
});
