import type { WorldSnapshot } from "@terrakin/protocol";
import { gatherableAt, isFindKind } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { type Camera, screenToTile, tileToScreen } from "./camera";
import { Mirror, OUT_MS } from "./mirror";
import { dayPhase, nightAmount } from "./time";

const snapshot: WorldSnapshot = {
  v: 1,
  seq: 3,
  hash: "x",
  time: { nowMs: 1_700_000_000_000, dayLengthMs: 600_000 },
  config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
  commons: { px: 1, py: 1 },
  residents: [
    {
      id: "a",
      name: "Ada",
      kind: "human",
      color: "sun",
      shape: "round",
      note: "",
      x: 6,
      y: 6,
      online: true,
      hearth: null,
    },
  ],
  plots: [],
  blocks: [],
};

describe("Mirror", () => {
  it("applies events in order", () => {
    const m = new Mirror(snapshot);
    const events = [
      { seq: 4, event: { type: "moved", residentId: "a", x: 6, y: 5 } },
      { seq: 5, event: { type: "plot_claimed", px: 0, py: 0, ownerId: "a" } },
      { seq: 6, event: { type: "block_placed", x: 1, y: 1, block: "leaf", by: "a" } },
    ] as const;
    for (const e of events) expect(m.apply(e)).toBe("applied");
    expect(m.residents.get("a")).toMatchObject({ x: 6, y: 5 });
    expect(m.ownerAt(3, 3)).toBe("a");
    expect(m.blocks.get("1,1")).toBe("leaf");
  });

  it("mirrors plot shares and clears a revoked co-owner's hearth", () => {
    const [ada] = snapshot.residents;
    if (!ada) throw new Error("fixture");
    const m = new Mirror({
      ...snapshot,
      residents: [ada, { ...ada, id: "b", name: "Bea", hearth: { x: 1, y: 2 } }],
      plots: [{ px: 0, py: 0, ownerId: "a", coOwners: ["b"] }],
    });
    expect(m.coOwnersAt(1, 1)).toEqual(["b"]);
    const events = [
      { seq: 4, event: { type: "plot_shared", px: 0, py: 0, residentId: "c" } },
      { seq: 5, event: { type: "plot_unshared", px: 0, py: 0, residentId: "b" } },
      { seq: 5, event: { type: "hearth_cleared", residentId: "b" } },
    ] as const;
    for (const e of events) expect(m.apply(e)).toBe("applied");
    expect(m.coOwnersAt(1, 1)).toEqual(["c"]);
    expect(m.ownerAt(1, 1)).toBe("a");
    expect(m.residents.get("b")?.hearth).toBeNull();
    m.apply({ seq: 6, event: { type: "plot_unshared", px: 0, py: 0, residentId: "c" } });
    expect(m.coOwners.size).toBe(0);
  });

  it("mirrors a release of a shared plot", () => {
    const [ada] = snapshot.residents;
    if (!ada) throw new Error("fixture");
    const m = new Mirror({
      ...snapshot,
      residents: [
        { ...ada, hearth: { x: 1, y: 1 } },
        { ...ada, id: "b", name: "Bea", hearth: { x: 2, y: 2 } },
      ],
      plots: [{ px: 0, py: 0, ownerId: "a", coOwners: ["b"] }],
    });
    const events = [
      { seq: 4, event: { type: "plot_unshared", px: 0, py: 0, residentId: "b" } },
      { seq: 4, event: { type: "hearth_cleared", residentId: "b" } },
      { seq: 4, event: { type: "plot_released", px: 0, py: 0, ownerId: "a" } },
      { seq: 4, event: { type: "hearth_cleared", residentId: "a" } },
    ] as const;
    for (const e of events) expect(m.apply(e)).toBe("applied");
    expect(m.ownerAt(1, 1)).toBeUndefined();
    expect(m.coOwnersAt(1, 1)).toEqual([]);
    expect(m.residents.get("a")?.hearth).toBeNull();
    expect(m.residents.get("b")?.hearth).toBeNull();
  });

  it("asks the sim's rule whose pickups a resident may take, from the snapshot and live", () => {
    const m = new Mirror({ ...snapshot, plots: [{ px: 0, py: 0, ownerId: "a", coOwners: ["b"] }] });
    // Before the switch, anyone may gather anywhere.
    expect(m.mayGatherAt(1, 1, "c")).toBe(true);
    expect(m.apply({ seq: 4, event: { type: "plot_pickups_owned" } })).toBe("applied");
    expect(m.mayGatherAt(1, 1, "a")).toBe(true);
    expect(m.mayGatherAt(1, 1, "b")).toBe(true);
    expect(m.mayGatherAt(1, 1, "c")).toBe(false);
    // The Commons and unclaimed land stay open.
    expect(m.mayGatherAt(5, 5, "c")).toBe(true);
    expect(m.mayGatherAt(9, 1, "c")).toBe(true);
    expect(new Mirror({ ...snapshot, plotPickupsOwned: true }).plotPickupsOwned).toBe(true);
  });

  it("draws finds once the switch is on, and keeps one on display until it comes down", () => {
    const day = 20_400;
    const m = new Mirror({ ...snapshot, day });
    // A tile with a find on it today once finds are out, from the sim's own spawn.
    let tile: { x: number; y: number } | undefined;
    for (let d = day; !tile; d++) {
      for (let y = 0; y < 12 && !tile; y++) {
        for (let x = 0; x < 12 && !tile; x++) {
          if (isFindKind(gatherableAt(snapshot.config, x, y, d, true))) tile = { x, y };
        }
      }
      if (!tile) m.apply({ seq: m.seq + 1, event: { type: "day_started", day: d + 1 } });
    }
    const { x, y } = tile;
    expect(m.pickupAt(x, y)).toBeNull();
    expect(m.apply({ seq: m.seq + 1, event: { type: "finds_opened" } })).toBe("applied");
    expect(isFindKind(m.pickupAt(x, y))).toBe(true);
    const shown = { type: "find_displayed", x: 2, y: 2, kind: "geode", by: "a" } as const;
    expect(m.apply({ seq: m.seq + 1, event: shown })).toBe("applied");
    expect(m.shownFinds.get("2,2")).toMatchObject({ kind: "geode", by: "a" });
    m.apply({ seq: m.seq + 1, event: { type: "taken_down", x: 2, y: 2, by: "a" } });
    expect(m.shownFinds.size).toBe(0);
    // A new copy reads both from the snapshot.
    const fresh = new Mirror({
      ...snapshot,
      day: m.day as number,
      findsOpen: true,
      displayedFinds: [{ x: 2, y: 2, kind: "geode", by: "a", day: 1 }],
    });
    expect(fresh.pickupAt(x, y)).toBe(m.pickupAt(x, y));
    expect(fresh.shownFinds.get("2,2")).toEqual({ kind: "geode", by: "a", day: 1 });
  });

  it("mirrors profile changes and hearths", () => {
    const m = new Mirror(snapshot);
    const events = [
      {
        seq: 4,
        event: {
          type: "profile_changed",
          residentId: "a",
          color: "plum",
          shape: "diamond",
          note: "builds lighthouses",
        },
      },
      { seq: 5, event: { type: "hearth_set", residentId: "a", x: 1, y: 2 } },
    ] as const;
    for (const e of events) expect(m.apply(e)).toBe("applied");
    expect(m.residents.get("a")).toMatchObject({
      color: "plum",
      shape: "diamond",
      note: "builds lighthouses",
      hearth: { x: 1, y: 2 },
    });
  });

  it("mirrors a pet's rename with its day, so the once-a-day rename reads true", () => {
    const [ada] = snapshot.residents;
    if (!ada) throw new Error("fixture");
    const pet = { kind: "cat", coat: "ginger", name: "Biscut", adoptedDay: 9 } as const;
    const m = new Mirror({ ...snapshot, residents: [{ ...ada, pet }] });
    const renamed = { type: "pet_renamed", residentId: "a", name: "Biscuit", day: 10 } as const;
    expect(m.apply({ seq: 4, event: renamed })).toBe("applied");
    expect(m.residents.get("a")?.pet).toMatchObject({ name: "Biscuit", renamedDay: 10 });
  });

  it("turns residents the way they walk, facing south until they move", () => {
    const m = new Mirror(snapshot);
    expect(m.facing.get("a")).toBeUndefined();
    const steps = [
      [6, 5, "n"],
      [7, 5, "e"],
      [7, 6, "s"],
      [6, 6, "w"],
      // A long jump (going home) keeps the way they faced.
      [2, 4, "w"],
      [2, 3, "n"],
      [9, 9, "n"],
    ] as const;
    let seq = 4;
    for (const [x, y, dir] of steps) {
      m.apply({ seq: seq++, event: { type: "moved", residentId: "a", x, y } });
      expect(m.facing.get("a")).toBe(dir);
    }
  });

  it("draws someone out on a routine where they are until a few minutes after its last step", () => {
    const [ada] = snapshot.residents;
    if (!ada) throw new Error("fixture");
    let now = 0;
    const away = { ...ada, id: "b", name: "Bea", online: false, hearth: { x: 1, y: 1 } };
    const m = new Mirror({ ...snapshot, residents: [ada, away] }, () => now);
    const asleep = () => m.asleep("a").map((d) => d.r.id);
    const out = () => m.outOnRoutine("a").map((o) => [o.r.id, o.routine]);
    expect([asleep(), out()]).toEqual([["b"], []]);
    // The routine walks Bea home: she's drawn there, awake, and not asleep beside it.
    m.apply({
      seq: 4,
      event: { type: "moved", residentId: "b", x: 1, y: 1, routine: "walk_home" },
    });
    expect([asleep(), out()]).toEqual([[], [["b", "walk_home"]]]);
    now += OUT_MS - 1;
    expect(out()).toEqual([["b", "walk_home"]]);
    // Then she sleeps at home again.
    now += 1;
    expect([asleep(), out()]).toEqual([["b"], []]);
    // A page loaded mid-stroll starts with her out, and her coming back ends it.
    const loaded = new Mirror(
      { ...snapshot, residents: [ada, { ...away, routine: "stroll" }] },
      () => now,
    );
    expect(loaded.outOnRoutine("a").map((o) => o.routine)).toEqual(["stroll"]);
    loaded.apply({ seq: 4, event: { type: "joined", resident: { ...away, online: true } } });
    expect(loaded.outOnRoutine("a")).toEqual([]);
  });

  it("ignores stale events and reports gaps without applying them", () => {
    const m = new Mirror(snapshot);
    expect(m.apply({ seq: 2, event: { type: "left", residentId: "a" } })).toBe("stale");
    expect(m.apply({ seq: 9, event: { type: "left", residentId: "a" } })).toBe("gap");
    expect(m.residents.get("a")?.online).toBe(true);
    expect(m.seq).toBe(3);
  });
});

describe("camera", () => {
  const cam: Camera = { cx: 10, cy: 10, scale: 32, width: 320, height: 640 };

  it("round-trips tile and screen coordinates", () => {
    for (const [x, y] of [
      [10, 10],
      [7, 14],
      [12, 3],
    ] as const) {
      const { sx, sy } = tileToScreen(cam, x, y);
      expect(screenToTile(cam, sx + 5, sy - 5)).toEqual({ x, y });
    }
  });
});

describe("day and night", () => {
  const D = 600_000;

  it("maps server time to a phase of the day", () => {
    expect(dayPhase(0, D)).toBe(0); // dawn
    expect(dayPhase(D / 4, D)).toBe(0.25); // noon
    expect(dayPhase(D / 2, D)).toBe(0.5); // dusk
    expect(dayPhase(D * 0.75, D)).toBe(0.75); // midnight
    expect(dayPhase(D + 1000, D)).toBeCloseTo(1000 / D, 10); // wraps
    expect(dayPhase(-1000, D)).toBeCloseTo(1 - 1000 / D, 10); // negative handled
  });

  it("is darkest at midnight and bright at noon", () => {
    expect(nightAmount(0.25)).toBe(0);
    expect(nightAmount(0.75)).toBe(1);
    expect(nightAmount(0)).toBeCloseTo(0.5, 10);
    expect(nightAmount(0)).toBe(nightAmount(0.5));
  });
});
