import type { BlockKind } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { teaSpots } from "./tea-spots";

describe("where tea shows in the world (RFC 0047)", () => {
  const event = (tea: boolean, status = "live") => ({
    status,
    host: "ada",
    px: 1,
    py: 0,
    ...(tea ? { tea: true as const } : {}),
  });
  const facts = (blocks: [string, BlockKind][], hearth = { x: 11, y: 3 }) => ({
    plotSize: 8,
    blocks: new Map(blocks),
    hearthOf: (id: string) => (id === "ada" ? hearth : undefined),
  });

  it("stands on the host's table, else beside their hearth, and only while tea is out", () => {
    const table: [string, BlockKind][] = [["13,5", "table"]];
    expect(teaSpots({ ...facts(table), events: [event(true)] })).toEqual([
      { x: 13, y: 5, table: true },
    ]);
    // No table: the first open tile beside the hearth, a wall east of it passed over.
    expect(teaSpots({ ...facts([["12,3", "wood"]]), events: [event(true)] })).toEqual([
      { x: 10, y: 3, table: false },
    ]);
    // No tea, or no longer on: nothing.
    expect(teaSpots({ ...facts(table), events: [event(false), event(true, "ended")] })).toEqual([]);
    // A hearth off the event's plot: the plot's middle.
    expect(teaSpots({ ...facts([], { x: 40, y: 40 }), events: [event(true)] })).toEqual([
      { x: 12, y: 4, table: false },
    ]);
  });
});
