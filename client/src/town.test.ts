import { describe, expect, it } from "vitest";
import { closesIn, nextCell, statusWord, tallyBar } from "./town-format";

const tally = (yes: number, no: number, abstain: number, quorum = 3) => ({
  yes,
  no,
  abstain,
  electorate: 10,
  quorum,
});

describe("tallyBar", () => {
  it("is empty with no votes and counts toward quorum", () => {
    expect(tallyBar(tally(0, 0, 0))).toEqual({
      yes: 0,
      no: 0,
      abstain: 0,
      counted: 0,
      quorum: 3,
      quorumMet: false,
      label: "0 of 3 votes needed",
    });
  });

  it("splits the bar into shares that add up to 100", () => {
    for (const [y, n, a] of [
      [1, 1, 1],
      [2, 1, 0],
      [1, 2, 4],
      [5, 5, 5],
      [1, 1, 0],
    ] as const) {
      const bar = tallyBar(tally(y, n, a));
      expect(bar.yes + bar.no + bar.abstain, `${y}/${n}/${a}`).toBe(100);
      expect(Math.min(bar.yes, bar.no, bar.abstain)).toBeGreaterThanOrEqual(0);
    }
    expect(tallyBar(tally(1, 1, 1))).toMatchObject({ yes: 33, no: 33, abstain: 34 });
  });

  it("doesn't count abstentions toward quorum, and says which way it leans once met", () => {
    expect(tallyBar(tally(2, 0, 5))).toMatchObject({ counted: 2, quorumMet: false });
    expect(tallyBar(tally(2, 1, 0)).label).toBe("Passing");
    expect(tallyBar(tally(2, 2, 0)).label).toBe("Not passing");
    expect(tallyBar(tally(3, 1, 0, 5)).label).toBe("4 of 5 votes needed");
  });
});

describe("closesIn", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  it("says how long is left in days, hours, and minutes", () => {
    expect(closesIn("2026-10-06T00:00:00.000Z", now)).toBe("Closes in 1 day, 9 hours");
    expect(closesIn("2026-10-05T00:00:00.000Z", now)).toBe("Closes in 9 hours");
    expect(closesIn("2026-10-04T16:35:00.000Z", now)).toBe("Closes in 1 hour, 35 minutes");
    expect(closesIn("2026-10-04T15:02:00.000Z", now)).toBe("Closes in 2 minutes");
    expect(closesIn("2026-10-04T15:00:30.000Z", now)).toBe("Closing now");
    expect(closesIn("nonsense", now)).toBe("Closing now");
  });
});

describe("nextCell", () => {
  it("cycles an empty tile through the block kinds and back to empty", () => {
    const seen: (string | null)[] = [];
    let cell = nextCell(null, false);
    while (cell !== null) {
      seen.push(cell);
      cell = nextCell(cell, false);
    }
    expect(seen).toEqual(["wood", "stone", "glass", "leaf"]);
  });

  it("toggles a tile that has a block between keeping it and taking it away", () => {
    expect(nextCell(null, true)).toBe("remove");
    expect(nextCell("remove", true)).toBeNull();
  });
});

describe("statusWord", () => {
  it("names every status in plain words", () => {
    expect(statusWord("no_quorum")).toBe("Not enough votes");
    expect(statusWord("failed")).toBe("Didn't pass");
  });
});
