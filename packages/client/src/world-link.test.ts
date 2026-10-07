import type { WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { type LookWorld, placeOf, wayThere } from "./look-card";
import { readWorldLink, worldLinkPath } from "./world-link";

describe("reading a link into the world", () => {
  it("has nothing to read without at or view", () => {
    expect(readWorldLink("")).toBeUndefined();
    expect(readWorldLink("?ref=x")).toBeUndefined();
  });

  it("reads a resident, a plot, and 3D", () => {
    expect(readWorldLink("?at=r_0123456789abcdef")).toEqual({
      at: { kind: "resident", id: "r_0123456789abcdef" },
    });
    expect(readWorldLink("?at=3,12&view=3d")).toEqual({
      at: { kind: "plot", px: 3, py: 12 },
      view3d: true,
    });
    expect(readWorldLink("?at=3%2C12")).toEqual({ at: { kind: "plot", px: 3, py: 12 } });
    expect(readWorldLink("?view=3d")).toEqual({ view3d: true });
  });

  it("marks an at it can't read, and ignores a view it doesn't know", () => {
    for (const bad of ["", "3,", "-1,2", "1.5,2", "<b>", "a b", "x".repeat(65)])
      expect(readWorldLink(`?at=${encodeURIComponent(bad)}`)).toEqual({ badAt: true });
    expect(readWorldLink("?view=4d")).toEqual({});
  });

  it("writes the link it reads", () => {
    for (const target of [
      { kind: "plot", px: 4, py: 0 },
      { kind: "resident", id: "t_wren" },
    ] as const) {
      const path = worldLinkPath(target, true);
      expect(path.startsWith("/world?")).toBe(true);
      expect(readWorldLink(path.slice("/world".length))).toEqual({ at: target, view3d: true });
    }
    expect(worldLinkPath({ kind: "plot", px: 4, py: 0 })).toBe("/world?at=4,0");
  });
});

const CONFIG = {
  width: 40,
  height: 40,
  plotSize: 8,
  reach: 2,
  maxPlotsPerResident: 1,
} as WorldConfig;

type Who = { id: string; name: string; online: boolean; x: number; y: number; hearth: null };

/** A 5 by 5 plot world: the Commons at (2, 2), Ivy's named plot at (3, 2), Sam's at (0, 0). */
function world(extra: { out?: string; asleep?: { id: string; x: number; y: number } } = {}) {
  const who = (id: string, name: string, online: boolean, x: number, y: number): Who => ({
    id,
    name,
    online,
    x,
    y,
    hearth: null,
  });
  const residents = new Map(
    [
      who("ivy", "Ivy", true, 27, 19),
      who("sam", "Sam", true, 17, 18),
      who("lee", "Lee", false, 3, 3),
      who("ren", "Ren", false, 5, 5),
    ].map((r) => [r.id, r]),
  );
  const w: LookWorld = {
    config: CONFIG,
    commons: { px: 2, py: 2 },
    residents,
    plots: new Map([
      ["3,2", "ivy"],
      ["0,0", "sam"],
    ]),
    coOwners: new Map([["0,0", ["lee"]]]),
    plotNames: new Map([["3,2", "Willow Rest"]]),
    outOnRoutine: () => (extra.out ? [{ r: { id: extra.out }, routine: "stroll" }] : []),
    asleep: () => (extra.asleep ? [{ r: { id: extra.asleep.id }, ...extra.asleep }] : []),
  };
  return w;
}

describe("finding a link's place on the map", () => {
  it("finds a resident up and about, and follows them", () => {
    expect(placeOf(world(), { kind: "resident", id: "ivy" })).toEqual({
      x: 27,
      y: 19,
      px: 3,
      py: 2,
      title: "Ivy",
      line: "At Willow Rest",
      profile: "ivy",
      follow: "ivy",
    });
    expect(placeOf(world(), { kind: "resident", id: "sam" })?.line).toBe("In the Commons");
  });

  it("finds someone away where the map draws them, or not at all", () => {
    const out = placeOf(world({ out: "lee" }), { kind: "resident", id: "lee" });
    expect(out).toMatchObject({ x: 3, y: 3, line: "Out on a stroll", follow: "lee" });
    const asleep = placeOf(world({ asleep: { id: "lee", x: 2, y: 4 } }), {
      kind: "resident",
      id: "lee",
    });
    expect(asleep).toMatchObject({ x: 2, y: 4, px: 0, py: 0, line: "Asleep at home" });
    expect(asleep?.follow).toBeUndefined();
    // Away with no hearth to sleep at: the map doesn't draw them.
    expect(placeOf(world(), { kind: "resident", id: "ren" })).toBeUndefined();
    expect(placeOf(world(), { kind: "resident", id: "nobody" })).toBeUndefined();
  });

  it("names a plot by its name, whose it is, or what it is", () => {
    expect(placeOf(world(), { kind: "plot", px: 3, py: 2 })).toEqual({
      x: 28,
      y: 20,
      px: 3,
      py: 2,
      title: "Willow Rest",
      line: "Ivy's plot",
      profile: "ivy",
    });
    expect(placeOf(world(), { kind: "plot", px: 0, py: 0 })?.title).toBe("Sam and Lee's plot");
    expect(placeOf(world(), { kind: "plot", px: 0, py: 0 }, "lee")?.title).toBe("Your plot");
    expect(placeOf(world(), { kind: "plot", px: 2, py: 2 })?.title).toBe("The Commons");
    expect(placeOf(world(), { kind: "plot", px: 4, py: 4 })).toMatchObject({
      title: "An empty plot",
      line: "Nobody lives here yet.",
      profile: null,
    });
    expect(placeOf(world(), { kind: "plot", px: 5, py: 0 })).toBeUndefined();
    expect(placeOf(world(), { kind: "plot", px: 0, py: 5 })).toBeUndefined();
  });
});

describe("going there", () => {
  it("visits a neighbor's plot, walks to the Commons or an empty plot, and goes home to your own", () => {
    const w = world();
    const place = (px: number, py: number) => ({ x: px * 8 + 4, y: py * 8 + 4, px, py });
    expect(wayThere(w, place(3, 2), "sam")).toEqual({ type: "visit", px: 3, py: 2 });
    expect(wayThere(w, place(2, 2), "sam")).toEqual({ type: "walk", to: { x: 20, y: 20 } });
    expect(wayThere(w, place(4, 4), "sam")).toEqual({ type: "walk", to: { x: 36, y: 36 } });
    // Your own plot, or one shared with you: Home when your hearth is there, else a walk.
    expect(wayThere(w, place(0, 0), "lee")).toEqual({ type: "walk", to: { x: 4, y: 4 } });
    const withHearth = {
      ...w,
      residents: new Map([
        ...w.residents,
        ["lee", { id: "lee", name: "Lee", online: true, x: 9, y: 9, hearth: { x: 2, y: 2 } }],
      ]),
    };
    expect(wayThere(withHearth, place(0, 0), "lee")).toEqual({ type: "home" });
  });
});
