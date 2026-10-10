import type { WorldEvent } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";
import { DAY_MS, WorldService } from "./world-service";
import { toWire } from "./world-wire";

/**
 * Levels (RFC 0029) are in the sim before the API opens them. Until then the server never logs
 * their switch, and none of their events leaves it.
 */
describe("levels, before the API opens them", () => {
  it("are never switched on, with every switch terrakin.org sets", () => {
    let now = Date.UTC(2026, 9, 9, 12);
    const store = new MemoryStore();
    const service = new WorldService({
      store,
      now: () => now,
      days: true,
      economy: true,
      items: true,
      gifts: true,
      plotPickups: true,
      finds: true,
      solidBuildings: true,
      tableSpots: true,
      shop: true,
      recipes: true,
      holidayPrices: true,
      market: true,
      bounties: true,
      presence: true,
    });
    for (let day = 0; day < 3; day++) {
      service.tick();
      now += DAY_MS;
    }
    const logged = store.log.map((input) => input.command.type);
    // The newest switch before it is on, so the table ran.
    expect(logged).toContain("open_recipes");
    expect(logged).not.toContain("open_levels");
    expect(logged).not.toContain("credit_event");
    expect(service.state.progress).toBeUndefined();
  });

  it("put no level event on the wire", () => {
    const events: WorldEvent[] = [
      { type: "levels_opened" },
      {
        type: "progress",
        residentId: "r_ada",
        skill: "growing",
        points: 12,
        firsts: ["pumpkin"],
        total: 12,
        today: 2,
      },
      { type: "level_reached", residentId: "r_ada", skill: "growing", level: 2 },
      { type: "level_reached", residentId: "r_ada", level: 2 },
      { type: "event_credited", event: "e_1", guests: ["r_bob"] },
      { type: "title_changed", residentId: "r_ada", title: "gardener" },
      { type: "left", residentId: "r_ada" },
    ];
    expect(toWire(events)).toEqual([{ type: "left", residentId: "r_ada" }]);
  });
});
