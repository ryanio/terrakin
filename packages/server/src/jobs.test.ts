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
    expect(logged).not.toContain("set_job_edition");
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
      /open_jobs|set_job_edition|take_job|drop_job|hand_in|jobsOn|\bjobs\s*[:?]/.test(
        readFileSync(file, "utf8"),
      ),
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
        total: 13,
      },
      { type: "job_dropped", residentId: "r_ada", job: "sable_night_fish", lapsed: true },
      { type: "job_total", residentId: "r_ada", total: 14 },
      { type: "job_edition_set", edition: 2 },
      // A title from jobs finished stays in. A skill's goes out as it always did.
      { type: "title_changed", residentId: "r_ada", title: "helping_hand" },
      { type: "title_changed", residentId: "r_ada", title: "gardener" },
      { type: "title_changed", residentId: "r_ada", title: null },
      { type: "left", residentId: "r_ada" },
    ];
    expect(toWire(events)).toEqual([
      { type: "title_changed", residentId: "r_ada", title: "gardener" },
      { type: "title_changed", residentId: "r_ada", title: null },
      { type: "left", residentId: "r_ada" },
    ]);
  });
});
