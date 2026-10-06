import { groundOf, type Pet, tileKey, type WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  aThing,
  bedBy,
  DOZE_OFF_MS,
  followSpot,
  HAPPY_MS,
  homePlan,
  lyingOn,
  PetMotion,
  type PetScene,
  petCalled,
  petLine,
  SLOT_MS,
  WANDER,
} from "./pets";

/** A 3 by 3 world of 8-tile plots, and a hut's walls around (3, 3) like a starter home. */
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const HEARTH = { x: 3, y: 3 };
function hut(extra: [number, number][] = []) {
  const blocks = new Set<string>();
  for (let x = 1; x <= 5; x++) {
    for (let y = 1; y <= 5; y++) {
      const edge = x === 1 || x === 5 || y === 1 || y === 5;
      if (edge && !(x === 3 && y === 5)) blocks.add(tileKey(x, y));
    }
  }
  for (const [x, y] of extra) blocks.add(tileKey(x, y));
  return groundOf({
    config: CONFIG,
    hasBlock: (x, y) => blocks.has(tileKey(x, y)),
    solidBuildings: false,
    shopOpen: false,
  });
}

const PET: Pet = { kind: "cat", coat: "ginger", name: "Biscuit" };
const owner = (
  over: Partial<{ online: boolean; hearth: { x: number; y: number } | null }> = {},
) => ({
  id: "r_0123456789abcdef",
  online: false,
  hearth: HEARTH,
  pet: PET,
  ...over,
});
const scene = (over: Partial<PetScene> = {}): PetScene => ({
  now: 0,
  clock: 0,
  night: false,
  still: false,
  ground: hut(),
  config: CONFIG,
  day: 100,
  ...over,
});

/** Run a pet for `ms`, a frame every 16 ms, and every place it was drawn. */
function film(m: PetMotion, o: ReturnType<typeof owner>, s: PetScene, ms: number) {
  const poses = [];
  for (let t = 0; t <= ms; t += 16) {
    const pose = m.pose(o, { ...s, now: s.now + t, clock: s.clock + t });
    if (pose) poses.push(pose);
  }
  return poses;
}

describe("where a pet sleeps", () => {
  it("sleeps there all night, snuggled up against the hearth", () => {
    const m = new PetMotion();
    const last = film(m, owner(), scene({ night: true }), 3_000).at(-1);
    expect(last).toMatchObject({ asleep: true, doing: "sleep", facing: -1 });
    expect(last?.x).toBeGreaterThan(3.5);
    expect(last?.x).toBeLessThan(4);
  });

  it("beds down beside its owner asleep at the hearth, never on top of them", () => {
    const ground = hut();
    // Away, its owner lies east of the hearth (decision 0086), so the pet takes the west side.
    const lying = lyingOn([{ x: HEARTH.x + 0.72, y: HEARTH.y }]);
    expect(bedBy(ground, HEARTH)).toEqual({ x: 4, y: 3 });
    expect(bedBy(ground, HEARTH, lying)).toEqual({ x: 2, y: 3 });
    // Every side taken, it finds a corner.
    const sides = [
      { x: 3.72, y: 3 },
      { x: 2.28, y: 3 },
      { x: 3, y: 3.6 },
      { x: 3, y: 2.4 },
    ];
    expect(bedBy(ground, HEARTH, lyingOn(sides))).toEqual({ x: 4, y: 4 });
    const last = film(new PetMotion(), owner(), scene({ night: true, lying }), 3_000).at(-1);
    expect(last).toMatchObject({ asleep: true, doing: "sleep", facing: 1 });
    expect(last?.x).toBeGreaterThan(2);
    expect(last?.x).toBeLessThan(2.5);
  });
});

describe("a day at home", () => {
  it("is the same plan on every screen, and stays near the hearth", () => {
    const ground = hut();
    for (let slot = 0; slot < 40; slot++) {
      const clock = slot * SLOT_MS;
      const a = homePlan("r_1", true, false, clock, ground, HEARTH);
      expect(homePlan("r_1", true, false, clock, ground, HEARTH)).toEqual(a);
      expect(
        Math.max(Math.abs(a.to.x - HEARTH.x), Math.abs(a.to.y - HEARTH.y)),
      ).toBeLessThanOrEqual(WANDER);
      expect(ground.obstacle(a.to.x, a.to.y)).toBeUndefined();
    }
  });

  it("mostly sleeps while its owner is away, and plays more while they're out and about", () => {
    const ground = hut();
    const sleeps = (away: boolean) =>
      Array.from({ length: 300 }, (_, i) =>
        homePlan(`r_${i}`, away, false, i * SLOT_MS, ground, HEARTH),
      ).filter((p) => p.doing === "sleep").length;
    expect(sleeps(true)).toBeGreaterThan(150);
    expect(sleeps(false)).toBeLessThan(sleeps(true));
  });

  it("walks the sim's routes, never through a wall", () => {
    const m = new PetMotion();
    const ground = hut();
    // A long afternoon, slot after slot, owner away.
    for (const p of film(m, owner(), scene({ ground }), 20 * SLOT_MS)) {
      expect(ground.obstacle(Math.round(p.x), Math.round(p.y)), `${p.x},${p.y}`).toBeUndefined();
    }
  });
});

describe("out with its owner", () => {
  it("trots after them on their home plot and sits beside them, facing them", () => {
    const m = new PetMotion();
    const o = owner({ online: true });
    // They walk from the hearth out of the door to (3, 7).
    const s = scene({ drawn: { x: 3, y: 7 } });
    const last = film(m, o, s, 3_000).at(-1);
    expect(last?.doing).toBe("follow");
    expect(Math.max(Math.abs((last?.x ?? 0) - 3), Math.abs((last?.y ?? 0) - 7))).toBe(1);
    expect(last?.asleep).toBe(false);
  });

  it("curls up at their feet at night once they've stood still a while, and wakes when they move", () => {
    const m = new PetMotion();
    const o = owner({ online: true });
    const s = scene({ night: true, drawn: { x: 3, y: 7 } });
    expect(film(m, o, s, 2_000).at(-1)?.asleep).toBe(false);
    const later = { ...s, now: DOZE_OFF_MS + 2_500, clock: DOZE_OFF_MS + 2_500 };
    expect(m.pose(o, later)).toMatchObject({ doing: "follow", asleep: true });
    const moved = { ...later, now: later.now + 16, drawn: { x: 4, y: 7 } };
    expect(m.pose(o, moved)?.asleep).toBe(false);
  });

  it("stays home while they're off the plot", () => {
    const m = new PetMotion();
    const last = film(m, owner({ online: true }), scene({ drawn: { x: 12, y: 12 } }), 2_000).at(-1);
    expect(last?.doing).not.toBe("follow");
    expect(Math.abs((last?.x ?? 99) - HEARTH.x)).toBeLessThanOrEqual(WANDER);
  });

  it("follows a hearthless owner anywhere, and isn't drawn while they're away", () => {
    const m = new PetMotion();
    const o = owner({ online: true, hearth: null });
    expect(m.pose(o, scene({ drawn: { x: 12, y: 12 } }))?.doing).toBe("follow");
    expect(m.pose({ ...o, online: false }, scene())).toBeUndefined();
  });

  it("sits at their heel, beside or in front of them, never behind their head", () => {
    const ground = hut();
    // Nearest the pet among the spots at heel: east or west, or the row in front.
    expect(followSpot(ground, { x: 9, y: 9 }, { x: 12, y: 9 })).toEqual({ x: 10, y: 9 });
    expect(followSpot(ground, { x: 9, y: 9 }, { x: 4, y: 9 })).toEqual({ x: 8, y: 9 });
    expect(followSpot(ground, { x: 9, y: 9 }, { x: 9, y: 6 })).toEqual({ x: 10, y: 9 });
    expect(followSpot(ground, { x: 9, y: 9 }, { x: 9, y: 14 })).toEqual({ x: 9, y: 10 });
    // In the hut's doorway the walls are either side, so it sits in front.
    expect(followSpot(ground, { x: 3, y: 5 }, { x: 9, y: 9 })).toEqual({ x: 4, y: 6 });
  });
});

describe("happy", () => {
  it("shows a heart for a moment after a pat, and wakes up for it", () => {
    const m = new PetMotion();
    const s = scene({ night: true });
    film(m, owner(), s, 2_000);
    m.pat(owner().id, 2_000);
    const now = m.pose(owner(), { ...s, now: 2_100 });
    expect(now).toMatchObject({ happy: true, asleep: false });
    expect(now?.heart).toBeGreaterThan(0);
    const later = m.pose(owner(), { ...s, now: 2_000 + HAPPY_MS + 1 });
    expect(later).toMatchObject({ happy: false, heart: undefined, asleep: true });
  });

  it("stays happy all day after a treat", () => {
    const m = new PetMotion();
    const treated = {
      ...owner(),
      pet: { ...PET, treat: { day: 100, by: "r_x", kind: "strawberry" as const } },
    };
    expect(m.pose(treated, scene())?.happy).toBe(true);
    expect(m.pose(treated, scene({ day: 101 }))?.happy).toBe(false);
  });
});

describe("a tap on a pet", () => {
  const world = { hearthAt: (x: number, y: number) => x === HEARTH.x && y === HEARTH.y };

  it("is for someone else's pet on its own tile, never your own, and never the hearth's tile", () => {
    const m = new PetMotion();
    // Asleep for the night beside the hearth, east of it, leaning toward it.
    const last = film(m, owner(), scene({ night: true }), 3_000).at(-1);
    expect(last?.x).toBeGreaterThan(3.5);
    const bed = { x: 4, y: 3 };
    expect(m.tapped(bed, undefined, world)).toBe(owner().id);
    // A tap on the hearth walks there, and is too far from the pet even where hearths aren't known.
    expect(m.tapped(HEARTH, undefined, world)).toBeUndefined();
    expect(m.tapped(HEARTH, undefined, { hearthAt: () => false })).toBeUndefined();
    // Your own pet sits at your heel, on the tiles you tap to walk.
    expect(m.tapped(bed, owner().id, world)).toBeUndefined();
  });
});

describe("words", () => {
  it("calls a pet by its name, or by its kind while its name is held back", () => {
    expect(petCalled(PET)).toBe("Biscuit");
    expect(petCalled({ kind: "fox", name: "" }, "their")).toBe("their fox");
    expect(petLine({ kind: "fox", coat: "arctic" })).toBe("an arctic fox");
    expect(petLine({ kind: "cat", coat: "ginger" })).toBe("a ginger cat");
    expect(aThing("strawberry")).toBe("a strawberry");
    expect(aThing("herb")).toBe("a bunch of herbs");
  });
});
