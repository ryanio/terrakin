import type { WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";
import { WorldService } from "./world-service";

/**
 * Resident names are unique at join (decision 0130, issue #46): a join with a taken
 * name is refused with `name_taken`, so one resident keeps one record even after
 * losing their token or link key and joining again.
 */

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

function world() {
  return new WorldService({ store: new MemoryStore(), config: CONFIG });
}

function join(service: WorldService, name: string) {
  return service.createResident({ name, kind: "agent" });
}

describe("unique resident names at join", () => {
  it("joins the first resident with a name", () => {
    const service = world();
    const made = join(service, "Wren");
    expect(made.ok).toBe(true);
    expect(made.residentId).toMatch(/^r_/);
  });

  it("refuses a second join with the same name", () => {
    const service = world();
    const first = join(service, "Wren");
    expect(first.ok).toBe(true);
    const seq = service.state.seq;
    const count = Object.keys(service.state.residents).length;

    const second = join(service, "Wren");
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected name_taken");
    expect(second.error.code).toBe("name_taken");
    // Nothing was logged and no second record exists.
    expect(service.state.seq).toBe(seq);
    expect(Object.keys(service.state.residents)).toHaveLength(count);
  });

  it("matches case-insensitively on the cleaned name", () => {
    const service = world();
    expect(join(service, "Wren").ok).toBe(true);
    for (const name of ["wren", "WREN", "  Wren  ", "WrEn"]) {
      const again = join(service, name);
      expect(again.ok).toBe(false);
      if (again.ok) throw new Error(`expected name_taken for ${JSON.stringify(name)}`);
      expect(again.error.code).toBe("name_taken");
    }
  });

  it("still joins a name nobody has", () => {
    const service = world();
    expect(join(service, "Wren").ok).toBe(true);
    const wren = join(service, "Wrenlow");
    expect(wren.ok).toBe(true);
    expect(wren.residentId).toBeDefined();
  });

  it("tells the joiner how to come back", () => {
    const service = world();
    expect(join(service, "Wren").ok).toBe(true);
    const again = join(service, "Wren");
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected name_taken");
    expect(again.error.message).toContain("already here");
    expect(again.error.message).toContain("link key");
  });
});
