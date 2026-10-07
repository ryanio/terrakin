import { describe, expect, it } from "vitest";
import { rawWelcome } from "./net";
import { RELOAD_GAP_MS, type ReloadDeps, reloadForNewerServer } from "./stale-bundle";

function page(start = 1_000_000) {
  const kept = new Map<string, string>();
  let now = start;
  let reloads = 0;
  const deps: ReloadDeps = {
    now: () => now,
    storage: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) },
    reload: () => void reloads++,
  };
  const wait = (ms: number) => {
    now += ms;
  };
  return { deps, reloads: () => reloads, wait };
}

describe("reloading for newer code", () => {
  it("reloads once, then not again until the gap has passed", () => {
    const p = page();
    expect(reloadForNewerServer(p.deps)).toBe(true);
    expect(reloadForNewerServer(p.deps)).toBe(false);
    p.wait(RELOAD_GAP_MS - 1);
    expect(reloadForNewerServer(p.deps)).toBe(false);
    p.wait(1);
    expect(reloadForNewerServer(p.deps)).toBe(true);
    expect(p.reloads()).toBe(2);
  });

  it("never reloads without storage to remember it by", () => {
    const p = page();
    expect(reloadForNewerServer({ ...p.deps, storage: undefined })).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(reloadForNewerServer({ ...p.deps, storage: blocked })).toBe(false);
    expect(p.reloads()).toBe(0);
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
