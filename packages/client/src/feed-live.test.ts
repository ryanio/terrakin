import type { PostView } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  FOLLOWING_GAP_MS,
  LIVE_IDLE_MS,
  LIVE_POLL_MS,
  LIVE_RETRY_MS,
  newPosts,
  pollDue,
  refreshDelay,
  wantsRefresh,
  wantsSocket,
} from "./feed-live";
import { backoff } from "./net";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 12, minute)).toISOString();
const post = (id: string, minute: number) => ({ id, createdAt: at(minute) }) as PostView;

describe("new posts over the socket", () => {
  const known = new Set(["p_shown"]);

  it("refreshes for a post the wall doesn't show, but not for one it does or your own", () => {
    expect(wantsRefresh({ id: "p_new", authorId: "r_ash" }, known, "r_wren")).toBe(true);
    expect(wantsRefresh({ id: "p_new", authorId: "r_ash" }, known, null)).toBe(true);
    expect(wantsRefresh({ id: "p_shown", authorId: "r_ash" }, known, "r_wren")).toBe(false);
    expect(wantsRefresh({ id: "p_mine", authorId: "r_wren" }, known, "r_wren")).toBe(false);
  });

  it("waits a moment after a push, and never refreshes Following right after a poll", () => {
    const now = 1_000_000;
    expect(refreshDelay(now - 60_000, now, 1_500, FOLLOWING_GAP_MS)).toBe(1_500);
    expect(refreshDelay(now - 5_000, now, 1_500, FOLLOWING_GAP_MS)).toBe(15_000);
  });

  it("finds new posts by id, including one that arrived out of order", () => {
    const wall = [post("p_c", 30), post("p_a", 10)];
    // p_b was made before p_c but reached the feed after the wall showed p_c.
    const page = [post("p_d", 40), post("p_c", 30), post("p_b", 20), post("p_a", 10)];
    expect(newPosts(wall, page).map((p) => p.id)).toEqual(["p_d", "p_b"]);
  });

  it("doesn't count a post that slid into the page from below as new", () => {
    // p_old shows up in the first page only because a newer post was deleted.
    const wall = [post("p_c", 30), post("p_b", 20)];
    const page = [post("p_c", 30), post("p_b", 20), post("p_old", 5)];
    expect(newPosts(wall, page)).toEqual([]);
    expect(newPosts([], page).map((p) => p.id)).toEqual(["p_c", "p_b", "p_old"]);
  });

  it("polls on every tick without the socket, and only now and then with it", () => {
    const now = 1_000_000;
    expect(pollDue(false, now - 1, now)).toBe(true);
    expect(pollDue(true, now - 1, now)).toBe(false);
    expect(pollDue(true, now - LIVE_POLL_MS, now)).toBe(true);
  });

  it("holds a socket only while the page is visible and used, and waits after a refusal", () => {
    const now = 5_000_000;
    expect(wantsSocket(true, now - 1000, now)).toBe(true);
    expect(wantsSocket(false, now - 1000, now)).toBe(false);
    expect(wantsSocket(true, now - LIVE_IDLE_MS, now)).toBe(false);
    expect(wantsSocket(true, now - 1000, now, now - 1000)).toBe(false);
    expect(wantsSocket(true, now - 1000, now, now - LIVE_RETRY_MS)).toBe(true);
  });

  it("spreads reconnects out between half and all of the doubling wait", () => {
    expect(backoff(0, 1000, 30_000, () => 0)).toBe(500);
    expect(backoff(0, 1000, 30_000, () => 1)).toBe(1000);
    expect(backoff(3, 1000, 30_000, () => 0.5)).toBe(6000);
    expect(backoff(10, 1000, 30_000, () => 1)).toBe(30_000);
  });
});
