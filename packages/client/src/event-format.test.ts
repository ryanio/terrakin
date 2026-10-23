import { describe, expect, it } from "vitest";
import {
  defaultStart,
  dishesLine,
  eventLanterns,
  fromLocalInput,
  hostingWords,
  soonWords,
  teaLines,
  toLocalInput,
  whenWords,
} from "./event-format";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Tuesday 6 October 2026, 09:00 UTC. */
const NOW = Date.UTC(2026, 9, 6, 9);
const TODAY = Math.floor(NOW / DAY);

describe("an event's time, in the viewer's own zone", () => {
  it("says today, tomorrow, or the date, by the viewer's calendar", () => {
    const at = (h: number, d = 0) => new Date(NOW - 9 * HOUR + d * DAY + h * HOUR).toISOString();
    expect(whenWords(at(19), NOW, "UTC")).toBe("Today 19:00");
    expect(whenWords(at(18, 1), NOW, "UTC")).toBe("Tomorrow 18:00");
    expect(whenWords(at(18, 25), NOW, "UTC")).toBe("Sat 31 Oct, 18:00");
    // 23:00 UTC is already tomorrow morning in Tokyo, and the clock is Tokyo's.
    expect(whenWords(at(23), NOW, "Asia/Tokyo")).toBe("Tomorrow 08:00");
  });

  it("counts down to the start, and says when a live one ends", () => {
    const e = (startsIn: number) => ({
      startsAt: new Date(NOW + startsIn).toISOString(),
      endsAt: new Date(NOW + startsIn + HOUR).toISOString(),
      status: "scheduled" as const,
    });
    expect(soonWords(e(40 * 60_000), NOW, "UTC")).toBe("Starts in 40 minutes");
    expect(soonWords(e(5 * HOUR), NOW, "UTC")).toBe("Starts in 5 hours");
    expect(soonWords(e(3 * DAY), NOW, "UTC")).toBe("Starts in 3 days");
    expect(soonWords({ ...e(-HOUR / 2), status: "live" }, NOW, "UTC")).toBe("On until 09:30");
  });
});

describe("the Schedule sheet's start", () => {
  it("starts on the hour, at least two hours on, past the server's hour of notice", () => {
    expect(defaultStart(NOW)).toBe(NOW + 2 * HOUR);
    expect(defaultStart(NOW + 1)).toBe(NOW + 3 * HOUR);
  });

  it("reads back a datetime-local value as the same moment", () => {
    const start = defaultStart(NOW);
    expect(fromLocalInput(toLocalInput(start))).toBe(start);
    expect(fromLocalInput("tomorrow at seven")).toBeNaN();
  });
});

describe("lanterns on the map", () => {
  const world = (taken: string[] = [], day = TODAY) => ({
    plotSize: 8,
    day,
    taken: (x: number, y: number) => taken.includes(`${x},${y}`),
  });
  const mark = (
    fields: Partial<Parameters<typeof eventLanterns>[0] extends Iterable<infer M> ? M : never> = {},
  ) => ({
    id: "e_1",
    px: 2,
    py: 0,
    status: "scheduled" as const,
    startsAt: NOW + 10 * HOUR,
    ...fields,
  });

  it("hang one on an event's plot on its day, lit while it's on, on its first open corner", () => {
    expect(eventLanterns([mark()], world())).toEqual([{ x: 16, y: 0, lit: false }]);
    expect(eventLanterns([mark({ startsAt: NOW + DAY })], world())).toEqual([]);
    expect(eventLanterns([mark({ status: "live" })], world(["16,0"]))).toEqual([
      { x: 23, y: 0, lit: true },
    ]);
  });

  it("ring the Commons with lit lanterns while the town's own event is on", () => {
    const harvest = mark({ px: 1, py: 1, status: "live", town: true });
    const lit = eventLanterns([harvest], world(["8,8"]));
    expect(lit.length).toBeGreaterThan(10);
    expect(lit.every((l) => l.lit)).toBe(true);
    expect(lit).not.toContainEqual({ x: 8, y: 8, lit: true });
    const edge = (l: { x: number; y: number }) =>
      l.x === 8 || l.x === 15 || l.y === 8 || l.y === 15;
    expect(lit.every(edge)).toBe(true);
    // Before it starts, its day still gets the one lantern.
    expect(eventLanterns([{ ...harvest, status: "scheduled" }], world(["8,8"]))).toEqual([
      { x: 15, y: 8, lit: false },
    ]);
  });
});

describe("a host's record", () => {
  it("names events and guests, with people and AIs apart", () => {
    expect(hostingWords({ events: 6, guests: 41, people: 30, agents: 11 })).toBe(
      "Hosted 6 events, 41 guests (30 people, 11 AIs)",
    );
    expect(hostingWords({ events: 1, guests: 1, people: 0, agents: 1 })).toBe(
      "Hosted 1 event, 1 guest (1 AI)",
    );
    expect(hostingWords({ events: 2, guests: 0, people: 0, agents: 0 })).toBe("Hosted 2 events");
  });
});

describe("who a host's tea would reach", () => {
  const guest = (name: string, why?: string) => ({
    resident: { id: `r_${name}`, name, kind: "human" } as never,
    here: true,
    seen: 1,
    counted: why === undefined,
    ...(why ? { why } : {}),
  });
  it("names who gets a cup, how long they stay, and why the rest won't", () => {
    expect(
      teaLines({
        served: false,
        stay: 4,
        guests: [guest("Bob"), guest("Wren", "joined too recently to count")],
      }),
    ).toEqual([
      "A cup would go home with Bob once they've been here 20 minutes.",
      "Wren joined too recently to count.",
    ]);
    expect(teaLines({ served: false, stay: 2, guests: [] })).toEqual([
      "Nobody here would be counted for a cup yet, so the tea would stay with you.",
    ]);
    expect(teaLines({ served: true, stay: 2, guests: [guest("Bob"), guest("Cy")] })[0]).toBe(
      "Tea is out. A cup goes home with Bob and Cy once they've been here 10 minutes.",
    );
  });
});

describe("the Thanksgiving feast's table", () => {
  const by = (name: string) => ({ id: `r_${name}`, name, kind: "human" }) as never;
  it("names the newest dishes first and counts the rest", () => {
    expect(dishesLine([{ by: by("Ada"), kind: "pumpkin_pie" }])).toBe(
      "On the table: pumpkin pie from Ada.",
    );
    expect(
      dishesLine([
        { by: by("Ada"), kind: "pumpkin_pie" },
        { by: by("Bob"), kind: "candy" },
      ]),
    ).toBe("On the table: candy from Bob and pumpkin pie from Ada.");
    const five = ["Ada", "Bob", "Cy", "Dee", "Eve"].map((n) => ({
      by: by(n),
      kind: "candy" as const,
    }));
    expect(dishesLine(five)).toBe(
      "On the table: candy from Eve, candy from Dee, candy from Cy, and 2 more.",
    );
  });
});
