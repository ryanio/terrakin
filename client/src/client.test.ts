import type { WorldSnapshot } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { type Camera, screenToTile, stepToward, tileToScreen } from "./camera";
import { Mirror } from "./mirror";

const snapshot: WorldSnapshot = {
  v: 1,
  seq: 3,
  hash: "x",
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

  it("steps along the longer axis", () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe("e");
    expect(stepToward({ x: 0, y: 0 }, { x: 1, y: -4 })).toBe("n");
    expect(stepToward({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeUndefined();
  });
});
