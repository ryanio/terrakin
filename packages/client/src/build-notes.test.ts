import type { WorldSnapshot } from "@terrakin/protocol";
import {
  apply,
  type Command,
  createWorld,
  designNotes,
  TOWN_ACTOR,
  type WorldState,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { mirrorNotes, notesLabel, noteWords } from "./build-notes";
import { Mirror } from "./mirror";

/** The parts of a snapshot the mirror reads for notes, from the sim's world. */
function snapshotOf(state: WorldState): WorldSnapshot {
  const tiles = <T>(record: Record<string, T>, floor?: number) =>
    Object.entries(record).map(([key, value]) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y, ...(floor ? { floor } : {}), value };
    });
  const upstairs = Object.entries(state.floors ?? {});
  return {
    v: 1,
    seq: state.seq,
    hash: "0",
    time: { nowMs: 0, dayLengthMs: 600_000 },
    season: "autumn",
    weather: "clear",
    timeOfDay: "day",
    townHall: [],
    config: state.config,
    commons: { px: 1, py: 1 },
    residents: Object.values(state.residents) as WorldSnapshot["residents"],
    plots: Object.values(state.plots).map((p) => ({
      px: p.px,
      py: p.py,
      ownerId: p.ownerId,
      ...(p.floors ? { floors: p.floors } : {}),
    })),
    blocks: [
      ...tiles(state.blocks),
      ...upstairs.flatMap(([f, layer]) => tiles(layer.blocks, Number(f))),
    ].map(({ value, ...t }) => ({ ...t, block: value })),
    ground: [
      ...tiles(state.ground ?? {}),
      ...upstairs.flatMap(([f, layer]) => tiles(layer.ground, Number(f))),
    ].map(({ value, ...t }) => ({ ...t, ground: value })),
  };
}

describe("notes in the build bar (RFC 0032)", () => {
  it("are the sim's own, read from the mirror, and fold to one line saying how many", () => {
    const state = createWorld({
      width: 24,
      height: 24,
      plotSize: 8,
      maxPlotsPerResident: 1,
      reach: 3,
    });
    const ok = (actor: string, command: Command) =>
      expect(apply(state, { actor, command }), JSON.stringify(command)).toMatchObject({ ok: true });
    ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
    ok("ada", { type: "join", name: "Ada", kind: "human" });
    ok("ada", { type: "settle", px: 0, py: 0 });
    ok("ada", { type: "build_starter_home" });
    // Her doorway walled up, a third wall material, and no path: three notes.
    ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      blocks: [
        { x: 3, y: 5, block: "stone" },
        { x: 7, y: 7, block: "leaf" },
      ],
    });
    const notes = mirrorNotes(new Mirror(snapshotOf(state)), 0, 0);
    expect(notes).toEqual(designNotes(state, 0, 0));
    expect(notes.map((n) => n.code)).toEqual(["hearth_walled_in", "no_path", "many_materials"]);
    expect(notesLabel(notes)).toEqual({ text: "3 notes", name: "3 notes about this home" });
    expect(notesLabel(notes.slice(0, 1)).text).toBe("1 note");
    expect(notesLabel([]).text).toBe("");
    // In a person's words: no tile numbers, which the map never labels; the API keeps the sim's.
    const words = notes.map(noteWords);
    expect(words[0]).toBe(
      "Nobody can walk to the hearth here: the walls around it have no door or gap. Swap one for a door.",
    );
    expect(words[1]).toBe(
      "This plot has no path or flooring yet. Dirt, sand, moss, and fallen leaves are free on the Paths tab.",
    );
    for (const w of words) expect(w).not.toMatch(/\(\d+, \d+\)/);
  });
});
