import { describe, expect, it } from "vitest";
import type { NewcomerCounts, NewcomersResponse } from "../packages/protocol/src/index.ts";
import { cantSend, funnelReport, funnelSince } from "./funnel";

const counts = (over: Partial<NewcomerCounts> = {}): NewcomerCounts => ({
  joined: 0,
  claimed: 0,
  hearth: 0,
  thing: 0,
  plotName: 0,
  look: 0,
  social: 0,
  handle: 0,
  hearthAndThing: 0,
  pet: 0,
  job: 0,
  upstairs: 0,
  roof: 0,
  ...over,
});

// The 2026-10-19 read's people, and a quiet week before this one.
const people = counts({ joined: 25, claimed: 13, hearth: 10, thing: 5, hearthAndThing: 4 });
const agents = counts({ joined: 29, claimed: 28, hearth: 25 });
const funnel = (p: NewcomerCounts, a: NewcomerCounts): NewcomersResponse => ({
  today: "2026-10-25",
  weeks: [
    { week: "2026-10-19", people: p, agents: a, sameName: 0 },
    { week: "2026-10-12", people: counts(), agents: counts(), sameName: 0 },
  ],
  allTime: { week: null, people: p, agents: a, sameName: 0 },
  undated: 2,
});

describe("the dated funnel read", () => {
  it("prints all time as a table with each step's share, and only the weeks anyone joined", () => {
    const report = funnelReport(funnel(people, agents), "https://terrakin.org");
    expect(report).toContain("All time, 54 joined, 25 people and 29 AIs, 2 of them from before");
    expect(report).toContain("| Claimed a plot | 13 (52%) | 28 (97%) |");
    expect(report).toContain("| Set a hearth | 10 (40%) | 25 (86%) |");
    expect(report).toContain("Of the 10 people with a hearth, 4 got a first thing (40%).");
    expect(report).toContain("- This week: 54 joined (25 people, 29 AIs). claimed a plot 13 / 28,");
    expect(report).not.toContain("Week of Oct 12");
  });

  it("says what changed since a saved read, with each step's share of the new joins", () => {
    const later = counts({ joined: 35, claimed: 21, hearth: 12, thing: 7, hearthAndThing: 6 });
    const since = funnelSince(
      {
        readAt: "2026-10-25T18:55:00Z",
        base: "https://terrakin.org",
        funnel: funnel(people, agents),
      },
      funnel(later, agents),
    );
    expect(since).toContain("| Joined | +10 | 0 |");
    expect(since).toContain("| Claimed a plot | +8 (80% of 10) | 0 |");
    expect(since).toContain("| Set a hearth | +2 (20% of 10) | 0 |");
  });

  it("sends the staff key only over https, or to this machine", () => {
    expect(cantSend("https://terrakin.org", undefined)).toMatch(/No staff key/);
    expect(cantSend("http://terrakin.org", "tks_x")).toMatch(/plain http/);
    expect(cantSend("http://localhost:8797", "tks_x")).toBeUndefined();
    expect(cantSend("https://terrakin.org", "tks_x")).toBeUndefined();
  });
});
