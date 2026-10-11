import { describe, expect, it } from "vitest";
import { type Http, jobDayOver } from "../e2e/personas";

const DAY_MS = 864e5;

/**
 * A test server's clock and world, as `POST /v1/test/advance-day` moves them: the world's day
 * follows the clock forward and never goes back. `ahead` days of a world kept from an earlier run
 * sit in front of the clock, and `job` is on the board on days that are a multiple of 5.
 */
function testServer(ahead: number, today = 20_000) {
  let clockMs = today * DAY_MS;
  let day = today + ahead;
  const http: Http = {
    async call(method, path) {
      if (method === "GET" && path === "/v1/world") {
        return { status: 200, body: { day, time: { nowMs: clockMs } } };
      }
      if (method === "GET" && path === "/v1/jobs") {
        return { status: 200, body: { jobs: day % 5 === 0 ? [{ id: "job" }] : [] } };
      }
      const days = Number(new URL(path, "http://test").searchParams.get("days"));
      clockMs += days * DAY_MS;
      day = Math.max(day, Math.floor(clockMs / DAY_MS));
      return { status: 200, body: { day } };
    },
  };
  return { http, day: () => day };
}

describe("moving the test clock to a job's day", () => {
  it("finds the day on a fresh world", async () => {
    const server = testServer(0);
    expect(await jobDayOver(server.http, "job")).toBe(0);
    const later = testServer(0, 20_001);
    expect(await jobDayOver(later.http, "job")).toBe(4);
    expect(later.day() % 5).toBe(0);
  });

  it("catches the clock up first on a kept world whose day is ahead of it", async () => {
    // 300 days ahead, more than the 60 days a day at a time would ever cover, and a day the job
    // isn't on, so the clock has to move the world's day on past where it was.
    const kept = testServer(301);
    expect(await jobDayOver(kept.http, "job")).toBe(4);
    expect(kept.day()).toBe(20_305);
  });
});
