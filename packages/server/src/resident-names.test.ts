import type { Input, WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";
import { WorldService } from "./world-service";

/**
 * Resident names are unique at join (decision 0148, issue #46): a join with a taken name is
 * refused with `name_taken`, so one resident keeps one record even after losing their token or
 * link key and joining again. Records a log already holds stay, and a resident count leaves out
 * the ones nobody used (`repeatJoins`).
 */

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

function world(store = new MemoryStore()) {
  return new WorldService({ store, config: CONFIG });
}

function join(service: WorldService, name: string) {
  return service.createResident({ name, kind: "agent" });
}

describe("unique resident names at join", () => {
  it("refuses a second join with the same name, logging nothing, and says to keep the key", () => {
    const service = world();
    const first = join(service, "Wren");
    expect(first.ok).toBe(true);
    expect(first.residentId).toMatch(/^r_/);
    const seq = service.state.seq;
    const count = Object.keys(service.state.residents).length;

    const second = join(service, "Wren");
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected name_taken");
    expect(second.error.code).toBe("name_taken");
    expect(second.error.message).toContain("Pick another name");
    expect(second.error.message).toContain("saved token or link key");
    expect(second.error.message).toContain("https://terrakin.org/contact");
    expect(second.residentId).toBeUndefined();
    expect(service.state.seq).toBe(seq);
    expect(Object.keys(service.state.residents)).toHaveLength(count);
  });

  it("matches case-insensitively on the cleaned name, and never a longer name", () => {
    const service = world();
    expect(join(service, "Wren").ok).toBe(true);
    for (const name of ["wren", "WREN", "  Wren  ", "WrEn"]) {
      const again = join(service, name);
      expect(again.ok).toBe(false);
      if (again.ok) throw new Error(`expected name_taken for ${JSON.stringify(name)}`);
      expect(again.error.code).toBe("name_taken");
    }
    expect(join(service, "Wrenlow").ok).toBe(true);
  });

  it("matches look-alikes: invisible characters, fillers, and fullwidth letters", () => {
    const service = world();
    expect(join(service, "Wren").ok).toBe(true);
    for (const name of [
      "Wren\u2060", // word joiner
      "Wr\u00aden", // soft hyphen
      "Wren\ufe0f", // variation selector
      "Wren\u3164", // Hangul filler
      "W\u034fren", // combining grapheme joiner
      "\uff37ren", // fullwidth W
      "\uff37\uff32\uff25\uff2e", // fullwidth WREN
    ]) {
      const again = join(service, name);
      if (again.ok) throw new Error(`expected name_taken for ${JSON.stringify(name)}`);
      expect(again.error.code, JSON.stringify(name)).toBe("name_taken");
    }
    expect(Object.keys(service.state.residents)).toHaveLength(1);
  });

  it("matches a name already logged with a look-alike, both ways", () => {
    const store = new MemoryStore();
    store.appendInput({
      actor: "r_a",
      command: { type: "join", name: "\uff37ren", kind: "agent" },
    });
    const service = world(store);
    // The logged name replays as it was logged.
    expect(service.state.residents.r_a?.name).toBe("\uff37ren");
    const again = join(service, "wren");
    if (again.ok) throw new Error("expected name_taken");
    expect(again.error.code).toBe("name_taken");
  });
});

describe("resident counts and repeat joins", () => {
  /** A world booted from a log written before names were unique. */
  function booted(log: Input[]) {
    const store = new MemoryStore();
    for (const input of log) store.appendInput(input);
    return world(store);
  }
  const joined = (actor: string, name: string): Input[] => [
    { actor, command: { type: "join", name, kind: "agent" } },
    { actor, command: { type: "leave" } },
  ];

  it("leaves out unused records of a name someone used, and all but the first when nobody did", () => {
    const service = booted([
      // popper used the first record; two more were made and never used.
      { actor: "r_a", command: { type: "join", name: "popper", kind: "agent" } },
      { actor: "r_a", command: { type: "move", dir: "e" } },
      { actor: "r_a", command: { type: "leave" } },
      ...joined("r_b", "popper"),
      ...joined("r_c", "Popper"),
      // Nobody used either Blaze: the first one counts.
      ...joined("r_d", "Blaze"),
      ...joined("r_e", "Blaze"),
      // Harmonica's second record is the one in use.
      ...joined("r_f", "Harmonica"),
      ...joined("r_g", "Harmonica"),
      { actor: "r_g", command: { type: "join", name: "Harmonica", kind: "agent" } },
      { actor: "r_g", command: { type: "profile", note: "blues" } },
      { actor: "r_g", command: { type: "leave" } },
      // A name nobody else has counts even unused.
      ...joined("r_h", "Wren"),
    ]);
    const snapshot = service.snapshot();
    expect(snapshot.residents).toHaveLength(8);
    expect(snapshot.repeatJoins).toEqual(["r_b", "r_c", "r_e", "r_f"]);
    // Nothing in the world changed: every record is still there.
    expect(Object.keys(service.state.residents)).toHaveLength(8);
  });

  it("counts a repeat record once someone is online on it", () => {
    const service = booted([
      { actor: "r_a", command: { type: "join", name: "Blaze", kind: "agent" } },
      { actor: "r_a", command: { type: "move", dir: "e" } },
      ...joined("r_b", "Blaze"),
    ]);
    expect(service.snapshot().repeatJoins).toEqual(["r_b"]);
    // Whoever holds its token came back to it.
    expect(service.ensureOnline("r_b").ok).toBe(true);
    expect(service.snapshot().repeatJoins).toBeUndefined();
  });

  it("sends no list when every name is someone's own", () => {
    const service = world();
    join(service, "Wren");
    join(service, "Ada");
    expect(service.snapshot()).not.toHaveProperty("repeatJoins");
  });
});
