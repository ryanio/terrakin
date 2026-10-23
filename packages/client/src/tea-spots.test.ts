import type { BlockKind } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { teaSpots } from "./tea-spots";

describe("where tea shows in the world (RFC 0047)", () => {
  const event = (tea: boolean, status = "live") => ({
    status,
    host: "ada",
    px: 1,
    py: 1,
    ...(tea ? { tea: true as const, teaGlaze: "moss" as const } : {}),
  });
  const facts = (blocks: [string, BlockKind][], hearth = { x: 11, y: 11 }) => ({
    config: { width: 32, height: 32, plotSize: 8, maxPlotsPerResident: 1, reach: 3 },
    blocks: new Map(blocks),
    hearthOf: (id: string) => (id === "ada" ? hearth : undefined),
  });

  it("stands on a table in the event's area, else on the host's hearth, in its teapot's glaze", () => {
    // A table just past the plot's edge is in the event's area, so the teapot goes there.
    const table: [string, BlockKind][] = [["17,9", "table"]];
    expect(teaSpots({ ...facts(table), events: [event(true)] })).toEqual([
      { x: 17, y: 9, on: "table", glaze: "moss" },
    ]);
    // No table: on the hearth itself, never on the floor of the house beside it.
    expect(teaSpots({ ...facts([["12,11", "wood"]]), events: [event(true)] })).toEqual([
      { x: 11, y: 11, on: "hearth", glaze: "moss" },
    ]);
    // The host's own table comes before a neighbor's in the ring, whichever is further north.
    const both: [string, BlockKind][] = [
      ["12,7", "table"],
      ["13,13", "table"],
    ];
    expect(teaSpots({ ...facts(both), events: [event(true)] })).toEqual([
      { x: 13, y: 13, on: "table", glaze: "moss" },
    ]);
    // No tea, or no longer on: nothing.
    expect(teaSpots({ ...facts(table), events: [event(false), event(true, "ended")] })).toEqual([]);
    // No table and a hearth far off: the open ground at the plot's middle.
    expect(teaSpots({ ...facts([], { x: 30, y: 30 }), events: [event(true)] })).toEqual([
      { x: 12, y: 12, on: "ground", glaze: "moss" },
    ]);
  });
});
