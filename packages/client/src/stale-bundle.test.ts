import { describe, expect, it } from "vitest";
import { rawWelcome } from "./net";
import { RELOAD_GAP_MS, type ReloadDeps, reloadForNewerServer } from "./stale-bundle";

/** One tab: `load()` is the page starting again, as it does after a reload. */
function tab(start = 1_000_000) {
  const kept = new Map<string, string>();
  let now = start;
  let reloads = 0;
  const storage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
  };
  const load = (): ReloadDeps => ({
    now: () => now,
    loadedAt: now,
    storage,
    reload: () => void reloads++,
  });
  const wait = (ms: number) => {
    now += ms;
  };
  return { load, reloads: () => reloads, wait };
}

describe("reloading for newer code", () => {
  it("reloads once, then not again until the gap has passed", () => {
    const t = tab();
    expect(reloadForNewerServer(t.load())).toBe(true);
    t.wait(1000);
    expect(reloadForNewerServer(t.load())).toBe(false);
    t.wait(RELOAD_GAP_MS - 1001);
    expect(reloadForNewerServer(t.load())).toBe(false);
    t.wait(1);
    expect(reloadForNewerServer(t.load())).toBe(true);
    expect(t.reloads()).toBe(2);
  });

  it("covers every answer a page can't read before it unloads with one reload", () => {
    const t = tab();
    const page = t.load();
    expect(reloadForNewerServer(page)).toBe(true);
    t.wait(3);
    expect(reloadForNewerServer(page)).toBe(true);
    expect(t.reloads()).toBe(1);
  });

  it("never reloads without storage to remember it by", () => {
    const t = tab();
    const page = t.load();
    expect(reloadForNewerServer({ ...page, storage: undefined })).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(reloadForNewerServer({ ...page, storage: blocked })).toBe(false);
    expect(t.reloads()).toBe(0);
  });

  it("keeps the token from a welcome it couldn't parse", () => {
    expect(rawWelcome({ type: "welcome", token: "t", residentId: "r_1", world: { x: 1 } })).toEqual(
      { token: "t", residentId: "r_1" },
    );
    expect(rawWelcome({ type: "event", token: "t", residentId: "r_1" })).toBeUndefined();
    expect(rawWelcome({ type: "welcome", token: 3 })).toBeUndefined();
    expect(rawWelcome(null)).toBeUndefined();
  });
});
