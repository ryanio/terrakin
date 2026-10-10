import { readdirSync, readFileSync } from "node:fs";
import { DAY_MS, type WorldEvent } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";
import { WorldService } from "./world-service";
import { toWire } from "./world-wire";

/**
 * Jobs (RFC 0030) are in the sim before the API opens them. Until then the server never logs their
 * switch, and none of their events leaves it.
 */
describe("jobs, before the API opens them", () => {
  it("are never switched on, with every switch terrakin.org sets", () => {
    let now = Date.UTC(2026, 9, 10, 12);
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
      levels: true,
      market: true,
      bounties: true,
      presence: true,
    });
    // The levels switch waits for the collection book's credit, which `Api` wires.
    service.levelFirsts = () => [];
    for (let day = 0; day < 3; day++) {
      service.tick();
      now += DAY_MS;
    }
    const logged = store.log.map((input) => input.command.type);
    // The newest switch before jobs is on, so the table ran.
    expect(logged).toContain("open_levels");
    expect(logged).not.toContain("open_jobs");
    expect(service.state.jobs).toBeUndefined();
  });

  it("are named by no server code: no switch, no option, no route", () => {
    const sources = [
      ...readdirSync(new URL("./", import.meta.url), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
        .map((file) => new URL(`./${file}`, import.meta.url)),
      new URL("../cloudflare/worker.ts", import.meta.url),
    ];
    expect(sources.length).toBeGreaterThan(50);
    const naming = sources.filter((file) =>
      /open_jobs|take_job|drop_job|hand_in|jobsOn|\bjobs\s*[:?]/.test(readFileSync(file, "utf8")),
    );
    expect(naming.map((file) => file.pathname.split("/").pop())).toEqual([]);
  });

  it("put no job event on the wire", () => {
    const events: WorldEvent[] = [
      { type: "jobs_opened" },
      { type: "job_taken", residentId: "r_ada", job: "sable_night_fish" },
      { type: "job_progress", residentId: "r_ada", job: "juniper_herbs", count: 2, of: 3 },
      {
        type: "job_done",
        residentId: "r_ada",
        job: "sable_night_fish",
        skill: "foraging",
        points: 10,
        week: 2,
      },
      { type: "job_dropped", residentId: "r_ada", job: "sable_night_fish", lapsed: true },
      { type: "left", residentId: "r_ada" },
    ];
    expect(toWire(events)).toEqual([{ type: "left", residentId: "r_ada" }]);
  });
});
