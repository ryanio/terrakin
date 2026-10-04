import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import {
  LOOK_KEYS,
  MAX_WEAR,
  PATTERNS,
  sortWear,
  THEME_INFO,
  THEMES,
  WEAR_INFO,
  WEAR_ITEMS,
  WEAR_SLOTS,
  wearProblem,
} from "./looks";
import { replay } from "./replay";
import type { Command, Input, WorldConfig, WorldState } from "./types";
import { createWorld } from "./world";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function joined(): WorldState {
  const state = createWorld(CONFIG);
  apply(state, { actor: "capri", command: { type: "join", name: "Capri", kind: "human" } });
  return state;
}

const profile = (state: WorldState, fields: Omit<Extract<Command, { type: "profile" }>, "type">) =>
  apply(state, { actor: "capri", command: { type: "profile", ...fields } });

const code = (r: ReturnType<typeof apply>) => (r.ok ? null : r.rejection.code);

describe("looks catalog", () => {
  it("has at least ten themes, each with five hex colors and a real motif", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10);
    for (const theme of THEMES) {
      const { palette, motif, label } = THEME_INFO[theme];
      expect(label.length).toBeGreaterThan(0);
      expect(Object.values(palette)).toHaveLength(5);
      for (const color of Object.values(palette)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(PATTERNS).toContain(motif);
    }
  });

  it("gives every wear item a slot, and every slot something to wear", () => {
    for (const item of WEAR_ITEMS) expect(WEAR_SLOTS).toContain(WEAR_INFO[item].slot);
    for (const slot of WEAR_SLOTS) {
      expect(WEAR_ITEMS.filter((w) => WEAR_INFO[w].slot === slot).length).toBeGreaterThan(1);
    }
    expect(MAX_WEAR).toBe(3);
  });

  it("allows one of each slot, in any order, and sorts to hat, top, accessory", () => {
    expect(wearProblem(["basket", "apron", "straw_hat"])).toBeNull();
    expect(sortWear(["basket", "apron", "straw_hat"])).toEqual(["straw_hat", "apron", "basket"]);
    expect(wearProblem(["beret", "beanie"])).toMatch(/one hat/);
    expect(wearProblem(["straw_hat", "apron", "basket", "bow"])).toMatch(/at most 3/);
    expect(wearProblem(["cape"])).toMatch(/Unknown/);
    expect(wearProblem(["toString"])).toMatch(/Unknown/);
  });
});

describe("profile looks", () => {
  it("sets a theme, pattern, and wear, and reports the whole look", () => {
    const state = joined();
    const result = profile(state, {
      theme: "lemon",
      pattern: "citrus",
      wear: ["basket", "straw_hat"],
    });
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: "profile_changed",
          residentId: "capri",
          theme: "lemon",
          pattern: "citrus",
          wear: ["straw_hat", "basket"],
        },
      ],
    });
    expect(state.residents.capri).toMatchObject({
      theme: "lemon",
      pattern: "citrus",
      wear: ["straw_hat", "basket"],
    });
  });

  it("keeps fields that aren't sent, and clears with null or an empty wear list", () => {
    const state = joined();
    profile(state, {
      theme: "berry",
      pattern: "dots",
      wear: ["beret"],
      homeArt: "m_00000000000000aa",
    });
    expect(profile(state, { pattern: "hearts" }).ok).toBe(true);
    expect(state.residents.capri).toMatchObject({ theme: "berry", pattern: "hearts" });
    const cleared = profile(state, { theme: null, wear: [], homeArt: null });
    expect(cleared.ok).toBe(true);
    const r = state.residents.capri;
    expect(r && "theme" in r).toBe(false);
    expect(r && "wear" in r).toBe(false);
    expect(r && "homeArt" in r).toBe(false);
    expect(r?.pattern).toBe("hearts");
    // The event describes the look after the change: cleared fields are simply absent.
    if (cleared.ok) {
      const [event] = cleared.events;
      expect(event).not.toHaveProperty("theme");
      expect(event).toHaveProperty("pattern", "hearts");
    }
  });

  it("accepts upload ids for the media fields", () => {
    const state = joined();
    const ids = {
      patternMedia: "m_0123456789abcdef",
      homeArt: "m_00000000000000aa",
      homeModel: "m_00000000000000bb",
    };
    expect(profile(state, ids).ok).toBe(true);
    expect(state.residents.capri).toMatchObject(ids);
  });

  it("refuses unknown choices and bad media ids without changing anything", () => {
    const state = joined();
    profile(state, { theme: "lemon" });
    const before = hashWorld(state);
    const bad = [
      { theme: "pizza" },
      { pattern: "plaid" },
      { wear: ["cape"] },
      { wear: ["beret", "beanie"] },
      { wear: ["straw_hat", "apron", "basket", "bow"] },
      { patternMedia: "https://example.com/a.png" },
      { homeArt: "m_XYZ" },
      { homeModel: "../m_0123456789abcdef" },
    ];
    for (const fields of bad) {
      expect(code(profile(state, fields as never))).toBe("invalid_profile");
    }
    expect(hashWorld(state)).toBe(before);
  });

  it("calls an unchanged look a no-op, including wear in another order", () => {
    const state = joined();
    profile(state, { theme: "ocean", wear: ["scarf", "beanie"] });
    expect(code(profile(state, { theme: "ocean" }))).toBe("invalid_profile");
    expect(code(profile(state, { wear: ["beanie", "scarf"] }))).toBe("invalid_profile");
    expect(code(profile(state, { theme: null, pattern: null }))).toBeNull();
    expect(code(profile(state, { theme: null }))).toBe("invalid_profile");
  });

  it("sets a look on join and keeps it when the resident comes back", () => {
    const state = createWorld(CONFIG);
    const joinedEvent = apply(state, {
      actor: "capri",
      command: { type: "join", name: "Capri", kind: "human", theme: "lemon", wear: ["straw_hat"] },
    });
    expect(joinedEvent).toMatchObject({
      ok: true,
      events: [{ type: "joined", resident: { theme: "lemon", wear: ["straw_hat"] } }],
    });
    apply(state, { actor: "capri", command: { type: "leave" } });
    apply(state, { actor: "capri", command: { type: "join", name: "Capri", kind: "human" } });
    expect(state.residents.capri).toMatchObject({ theme: "lemon", wear: ["straw_hat"] });
  });

  it("replays a log with looks to the same hash", () => {
    const log: Input[] = [
      { actor: "capri", command: { type: "join", name: "Capri", kind: "human", theme: "lemon" } },
      { actor: "capri", command: { type: "profile", pattern: "citrus", wear: ["basket"] } },
      { actor: "capri", command: { type: "profile", patternMedia: "m_0123456789abcdef" } },
      { actor: "capri", command: { type: "profile", theme: null, wear: [] } },
    ];
    const state = createWorld(CONFIG);
    for (const input of log) expect(apply(state, input).ok).toBe(true);
    expect(hashWorld(replay(CONFIG, log))).toBe(hashWorld(state));
  });
});

describe("old logs", () => {
  // A log from before looks existed. Its hash was computed with the sim as it was on main before
  // this change (36920bf3), so this pins that looks changed nothing for worlds that never use them.
  const OLD_LOG: Input[] = [
    { actor: "r_ada", command: { type: "join", name: "Ada", kind: "human" } },
    {
      actor: "r_wren",
      command: {
        type: "join",
        name: "Wren",
        kind: "agent",
        color: "leaf",
        shape: "diamond",
        note: "gardens",
      },
    },
    { actor: "r_ada", command: { type: "profile", color: "plum", note: "builds boats" } },
    { actor: "r_ada", command: { type: "settle", px: 0, py: 0 } },
    { actor: "r_ada", command: { type: "build_starter_home", walls: "stone" } },
    { actor: "r_wren", command: { type: "move", dir: "e" } },
    { actor: "r_wren", command: { type: "profile", shape: "square" } },
    { actor: "r_wren", command: { type: "leave" } },
    { actor: "r_wren", command: { type: "join", name: "Wren", kind: "agent" } },
    { actor: "r_ada", command: { type: "share_plot", with: "r_wren" } },
  ];

  it("replay byte-identically, with no look fields anywhere", () => {
    const state = replay(CONFIG, OLD_LOG);
    expect(hashWorld(state)).toBe("36920bf3");
    for (const r of Object.values(state.residents)) {
      for (const key of LOOK_KEYS) expect(r).not.toHaveProperty(key);
    }
  });

  it("emit events with no look fields", () => {
    const state = createWorld(CONFIG);
    for (const input of OLD_LOG) {
      const result = apply(state, input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const event of result.events) {
        const target = event.type === "joined" ? event.resident : event;
        for (const key of LOOK_KEYS) expect(target).not.toHaveProperty(key);
      }
    }
  });
});
