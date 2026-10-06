import { describe, expect, it } from "vitest";
import {
  boardWords,
  closedQuorum,
  closesIn,
  comesDownIn,
  type PlanTile,
  planChanges,
  planLists,
  planWords,
  statusWord,
  tallyBar,
  tapPlan,
  townPaintKey,
} from "./town-format";

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

  it("rounds to the nearest minute, so a time just short of a day says a day", () => {
    expect(closesIn("2026-10-05T14:59:55.000Z", now)).toBe("Closes in 1 day");
  });
});

describe("comesDownIn", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  it("says when a notice leaves the board", () => {
    expect(comesDownIn("2026-10-06T15:00:00.000Z", now)).toBe("Comes down in 2 days");
    expect(comesDownIn("2026-10-05T00:00:00.000Z", now)).toBe("Comes down in 9 hours");
    expect(comesDownIn("2026-10-04T15:00:30.000Z", now)).toBe("Coming down now");
  });
});

describe("boardWords", () => {
  const limits = { days: 2, perResident: 3 };
  it("says how long notices stay up, and how many someone who can pin may have", () => {
    expect(boardWords(limits, false)).toBe("Notices stay up for 2 days.");
    expect(boardWords(limits, true)).toBe("Notices stay up for 2 days. You can have 3 up at once.");
  });
});

describe("the build editor", () => {
  it("puts a pick on an empty tile, takes it back on a second tap, and swaps in another pick", () => {
    const empty = {};
    const bench = tapPlan({}, "bench", empty);
    expect(bench).toEqual({ block: "bench" });
    expect(tapPlan(bench, "well", empty)).toEqual({ block: "well" });
    expect(tapPlan(bench, "bench", empty)).toEqual({});
    // A path goes under the bench on the same tile, and comes back up the same way.
    const paved = tapPlan(bench, "cobble", empty);
    expect(paved).toEqual({ block: "bench", ground: "cobble" });
    expect(tapPlan(paved, "cobble", empty)).toEqual({ block: "bench" });
  });

  it("takes away a block that's there, and lifts a path that's there, until tapped again", () => {
    const now = { block: "stone" as const, ground: "dirt" as const };
    const gone = tapPlan({}, "wood", now);
    expect(gone).toEqual({ block: "remove" });
    expect(tapPlan(gone, "wood", now)).toEqual({});
    expect(tapPlan(gone, "moss", now)).toEqual({ block: "remove", ground: "lift" });
  });

  it("counts each change and lists them as propose takes them, north to south", () => {
    const plan = new Map<string, PlanTile>([
      ["36,35", { block: "bench", ground: "cobble" }],
      ["35,34", { ground: "lift" }],
      ["34,34", { block: "remove" }],
    ]);
    expect(planChanges(plan)).toBe(4);
    const lists = planLists(plan);
    expect(lists).toEqual({
      blocks: [{ x: 36, y: 35, block: "bench" }],
      remove: [{ x: 34, y: 34 }],
      ground: [{ x: 36, y: 35, ground: "cobble" }],
      lift: [{ x: 35, y: 34 }],
    });
    expect(planWords(lists)).toBe("1 block, 1 path, 1 block taken away, and 1 path lifted");
  });
});

describe("statusWord", () => {
  it("names every status in plain words", () => {
    expect(statusWord("no_quorum")).toBe("Not enough votes");
    expect(statusWord("failed")).toBe("Didn't pass");
  });
});

describe("closedQuorum", () => {
  it("says the quorum was met instead of counting votes against it", () => {
    expect(closedQuorum(tally(4, 1, 2))).toBe("Quorum met with 5 votes");
    expect(closedQuorum(tally(2, 1, 0))).toBe("Quorum met with 3 votes");
    expect(closedQuorum(tally(1, 0, 4))).toBe("Short of quorum: 1 of 3 votes");
  });
});

describe("townPaintKey", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0, 10);
  const proposal = (yes: number) =>
    ({ id: "pr_1", closesAt: "2026-10-04T16:35:00.000Z", tally: tally(yes, 0, 0) }) as never;
  const town = (yes: number) => ({
    open: [proposal(yes)],
    queued: [],
    you: null,
    nextClose: "2026-10-04T16:35:00.000Z",
  });

  it("stays the same when a refresh brings nothing new", () => {
    expect(townPaintKey(town(1), now)).toBe(townPaintKey(town(1), now + 20_000));
  });

  it("changes with a vote, the Commons, or a closing time's minute", () => {
    const key = townPaintKey(town(1), now);
    expect(townPaintKey(town(2), now)).not.toBe(key);
    expect(townPaintKey(town(1), now, "map")).not.toBe(key);
    expect(townPaintKey(town(1), now + 60_000)).not.toBe(key);
  });
});
