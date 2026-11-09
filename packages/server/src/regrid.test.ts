import { DAY_MS, type Input, type WorldConfig } from "@terrakin/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./store";
import { recordTelemetry } from "./test-support";
import { WorldService } from "./world-service";

/**
 * The town logs `regrid` (RFC 0052) only once a dry run of it on a copy of the world holds
 * (`regridCheck`), and says why it waits in codes and counts.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** `WorldService.run`, which is private: the one door every input goes through. */
const runOn = (service: WorldService, input: Input) =>
  (service as unknown as { run(input: Input): { ok: boolean } }).run.call(service, input);

const telemetry = recordTelemetry();
beforeEach(telemetry.start);
afterEach(() => {
  telemetry.stop();
  vi.restoreAllMocks();
});

describe("the regrid switch", () => {
  it("waits while the dry run on a copy finds a problem, says which in codes and counts, and logs regrid once it holds", () => {
    let now = Date.UTC(2026, 10, 9, 9);
    const store = new MemoryStore();
    const service = new WorldService({
      store,
      config: CONFIG,
      now: () => now,
      days: true,
      economy: true,
      items: true,
      starterEdges: true,
      wallsOnLines: true,
      regrid: true,
    });
    for (const [id, px] of [
      ["ada", 0],
      ["bob", 2],
    ] as const) {
      expect(
        runOn(service, { actor: id, command: { type: "join", name: id, kind: "agent" } }).ok,
      ).toBe(true);
      expect(runOn(service, { actor: id, command: { type: "settle", px, py: 0 } }).ok).toBe(true);
    }
    service.onHomeSlimmed = () => {};
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    // This tick puts walls on lines; the regrid comes due on the next.
    service.tick();
    expect(service.state.wallsOnLines).toBe(true);
    expect(service.state.regridded).toBeUndefined();

    // Coins in a purse that were never minted: the copy's supply doesn't add up, so nothing is
    // logged, and the line names the check and how many, never a resident.
    const econ = service.state.economy;
    if (!econ) throw new Error("coins aren't open");
    econ.coins.ada = (econ.coins.ada ?? 0) + 5;
    const before = store.loadLog().length;
    service.tick();
    expect(
      store
        .loadLog()
        .slice(before)
        .map((i) => i.command.type),
    ).not.toContain("regrid");
    expect(service.state.config.plotSize).toBe(8);
    const lines = said.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("regrid"));
    expect(lines).toEqual([
      "The regrid's dry run didn't hold (supply 1), so it waits for another day.",
    ]);
    expect(telemetry.reports).toEqual(["regrid dry run: supply 1"]);

    // Mended the same day, it still waits for the next one: the dry run runs once a world day.
    econ.minted += 5;
    service.tick();
    expect(service.state.regridded).toBeUndefined();

    now += DAY_MS;
    service.tick();
    expect(service.state.regridded).toBe(true);
    expect(service.state.config.plotSize).toBe(16);
    expect(store.loadLog().filter((i) => i.command.type === "regrid")).toHaveLength(1);
    expect(telemetry.reports).toEqual(["regrid dry run: supply 1"]);

    // A design builds on the lot in the middle of the slot: its tiles count from the lot's corner,
    // (4, 4) on Ada's plot now, so the hut stands where the starter hut would.
    const hut = { type: "build", px: 0, py: 0, design: "hut", dry: true } as const;
    const built = service.act("ada", hut);
    expect(built).toMatchObject({ ok: true, dry: true });
    const walled = (built as { plan?: { walled: number } }).plan?.walled ?? 0;
    expect(walled).toBeGreaterThan(0);
  });
});
