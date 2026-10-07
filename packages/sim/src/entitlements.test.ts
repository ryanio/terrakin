import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { checkSetEntitlements, entitledTo } from "./entitlements";
import {
  ENTITLEMENTS_CONFIG,
  ENTITLEMENTS_HASH,
  ENTITLEMENTS_LOG,
} from "./fixtures/entitlements-log";
import { LOOKS_CONFIG, LOOKS_LOG } from "./fixtures/looks-log";
import { hashWorld } from "./hash";
import { EXCLUSIVE_WEAR, isExclusiveWear, SHOP_WEAR, WEAR_INFO, WEAR_ITEMS } from "./looks";
import { replay } from "./replay";
import type { Command, Input, WorldConfig, WorldState } from "./types";
import { TOWN_ACTOR } from "./types";
import { createWorld } from "./world";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function world(): WorldState {
  const state = createWorld(CONFIG);
  apply(state, { actor: "ada", command: { type: "join", name: "Ada", kind: "agent" } });
  apply(state, { actor: "bob", command: { type: "join", name: "Bob", kind: "human" } });
  return state;
}

const entitle = (state: WorldState, residentId: string, items: string[], actor = TOWN_ACTOR) =>
  apply(state, { actor, command: { type: "set_entitlements", residentId, items } });
const wear = (state: WorldState, actor: string, items: string[]) =>
  apply(state, { actor, command: { type: "profile", wear: items } as Command });
const code = (r: ReturnType<typeof apply>) => (r.ok ? null : r.rejection.code);

describe("partner wear (RFC 0007 phase 3)", () => {
  it("replays its log to the pinned hash", () => {
    const state = replay(ENTITLEMENTS_CONFIG, ENTITLEMENTS_LOG);
    expect(hashWorld(state)).toBe(ENTITLEMENTS_HASH);
    expect(state.entitlements).toEqual({ ada: ["muse_halo"] });
    expect(state.residents.ada?.wear).toEqual(["muse_halo", "dress", "socks"]);
    expect(state.residents.ada?.wearStyle?.muse_halo).toEqual({ color: "plum" });
    // A world that never logged one has no `entitlements` key.
    expect("entitlements" in replay(LOOKS_CONFIG, LOOKS_LOG)).toBe(false);
  });

  it("puts partner wear at the end of the catalog, off the shop, each in a slot", () => {
    expect(WEAR_ITEMS.slice(-EXCLUSIVE_WEAR.length)).toEqual([...EXCLUSIVE_WEAR]);
    for (const item of EXCLUSIVE_WEAR) {
      expect(WEAR_INFO[item].slot).toBeDefined();
      expect(SHOP_WEAR as readonly string[]).not.toContain(item);
    }
    expect(isExclusiveWear("muse_halo")).toBe(true);
    expect(isExclusiveWear("straw_hat")).toBe(false);
  });

  it("refuses partner wear without an entitlement, on join and on profile", () => {
    const state = world();
    const before = hashWorld(state);
    expect(code(wear(state, "ada", ["muse_halo"]))).toBe("not_entitled");
    const fresh: Input = {
      actor: "cy",
      command: { type: "join", name: "Cy", kind: "agent", wear: ["muse_lantern"] },
    };
    expect(code(apply(state, fresh))).toBe("not_entitled");
    expect(hashWorld(state)).toBe(before);
  });

  it("refuses styling partner wear without an entitlement, but always lets a style be cleared", () => {
    const state = world();
    const style = (wearStyle: unknown) =>
      apply(state, { actor: "ada", command: { type: "profile", wearStyle } as Command });
    expect(code(style({ muse_halo: { color: "plum" } }))).toBe("not_entitled");
    entitle(state, "ada", ["muse_halo"]);
    expect(code(style({ muse_halo: { color: "plum" } }))).toBeNull();
    entitle(state, "ada", []);
    expect(code(style({ muse_halo: null }))).toBeNull();
  });

  it("lets an entitled resident wear it, and takes it off when the entitlement goes", () => {
    const state = world();
    const set = entitle(state, "ada", ["muse_halo"]);
    expect(set.ok && set.events).toEqual([
      { type: "entitlements_set", residentId: "ada", items: ["muse_halo"] },
    ]);
    expect(code(wear(state, "ada", ["muse_halo", "scarf"]))).toBeNull();
    // Only her own: Bob still can't.
    expect(code(wear(state, "bob", ["muse_halo"]))).toBe("not_entitled");

    const gone = entitle(state, "ada", []);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.events[0]).toEqual({ type: "entitlements_set", residentId: "ada", items: [] });
    expect(gone.events[1]).toMatchObject({
      type: "profile_changed",
      residentId: "ada",
      wear: ["scarf"],
    });
    expect(state.residents.ada?.wear).toEqual(["scarf"]);
    expect(state.entitlements).toBeUndefined();
  });

  it("clears the wear list when partner wear was all they had on", () => {
    const state = world();
    entitle(state, "ada", ["muse_halo"]);
    wear(state, "ada", ["muse_halo"]);
    entitle(state, "ada", []);
    expect(state.residents.ada && "wear" in state.residents.ada).toBe(false);
  });

  it("keeps wear on when the entitlement only grows or swaps something else", () => {
    const state = world();
    entitle(state, "ada", ["muse_halo"]);
    wear(state, "ada", ["muse_halo"]);
    const grown = entitle(state, "ada", ["muse_halo", "muse_lantern"]);
    expect(grown.ok && grown.events).toHaveLength(1);
    expect(entitledTo(state, "ada")).toEqual(["muse_halo", "muse_lantern"]);
    const shrunk = entitle(state, "ada", ["muse_halo"]);
    expect(shrunk.ok && shrunk.events).toHaveLength(1);
    expect(state.residents.ada?.wear).toEqual(["muse_halo"]);
  });

  it("takes an entitlement for someone who hasn't joined yet, and they may wear it on joining", () => {
    const state = world();
    expect(code(entitle(state, "cy", ["muse_lantern"]))).toBeNull();
    const joined = apply(state, {
      actor: "cy",
      command: { type: "join", name: "Cy", kind: "agent", wear: ["muse_lantern"] },
    });
    expect(code(joined)).toBeNull();
  });

  it("is the server's alone, and refuses anything but partner wear, no-ops, and bad shapes", () => {
    const state = world();
    const before = hashWorld(state);
    expect(code(entitle(state, "ada", ["muse_halo"], "ada"))).toBe("server_only");
    expect(code(entitle(state, "ada", ["straw_hat"]))).toBe("unknown_item");
    expect(code(entitle(state, "ada", ["top_hat"]))).toBe("unknown_item");
    expect(code(entitle(state, "ada", ["cape"]))).toBe("unknown_item");
    expect(code(entitle(state, "ada", Array(17).fill("muse_halo")))).toBe("unknown_item");
    expect(code(entitle(state, "", ["muse_halo"]))).toBe("unknown_resident");
    expect(code(entitle(state, "ada", []))).toBe("already_have");
    expect(
      checkSetEntitlements(state, {
        type: "set_entitlements",
        residentId: "ada",
        items: "muse_halo" as unknown as string[],
      }),
    ).toMatchObject({ code: "unknown_item" });
    expect(hashWorld(state)).toBe(before);
    entitle(state, "ada", ["muse_lantern", "muse_halo", "muse_halo"]);
    expect(entitledTo(state, "ada")).toEqual(["muse_halo", "muse_lantern"]);
    expect(code(entitle(state, "ada", ["muse_halo", "muse_lantern"]))).toBe("already_have");
  });
});
