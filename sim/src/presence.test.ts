import { describe, expect, it } from "vitest";
import { apply, asJoined, prepare, rejoined } from "./apply";
import {
  ENTITLEMENTS_CONFIG,
  ENTITLEMENTS_HASH,
  ENTITLEMENTS_LOG,
} from "./fixtures/entitlements-log";
import { PRESENCE_CONFIG, PRESENCE_HASH, PRESENCE_LOG } from "./fixtures/presence-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { expectSupplyHolds } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { createWorld, spawnTile } from "./world";

// 3x3 plots of 4 tiles. Commons is plot (1,1), tiles 4..7. Spawn is tile (6,6).
const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

const town = (state: WorldState, command: Command) => apply(state, { actor: TOWN_ACTOR, command });
const act = (state: WorldState, actor: string, command: Command) =>
  apply(state, { actor, command });
const code = (result: ReturnType<typeof apply>) => (result.ok ? null : result.rejection.code);

/** Ada and Bob in the Commons, with presence coming from acting when `on`. */
function world(on = true): WorldState {
  const state = createWorld(CONFIG);
  for (const name of ["ada", "bob"]) act(state, name, { type: "join", name, kind: "human" });
  if (on) expect(town(state, { type: "implicit_presence" }).ok).toBe(true);
  return state;
}

describe("the presence fixture", () => {
  it("replays to its pinned hash, and the log before the switch hashes as before", () => {
    expect(hashWorld(replay(ENTITLEMENTS_CONFIG, ENTITLEMENTS_LOG))).toBe(ENTITLEMENTS_HASH);
    const state = replay(PRESENCE_CONFIG, PRESENCE_LOG);
    expect(hashWorld(state)).toBe(PRESENCE_HASH);
    expectSupplyHolds(state);
    expect(state.implicitPresence).toBe(true);
    expect(
      Object.values(state.residents)
        .filter((r) => r.online)
        .map((r) => r.id),
    ).toEqual(["ada"]);
  });
});

describe("implicit_presence", () => {
  it("turns on once, from the server only", () => {
    const state = world(false);
    expect(code(act(state, "ada", { type: "implicit_presence" }))).toBe("server_only");
    const on = town(state, { type: "implicit_presence" });
    expect(on).toMatchObject({ ok: true, events: [{ type: "implicit_presence_on" }] });
    expect(state.implicitPresence).toBe(true);
    const before = hashWorld(state);
    expect(code(town(state, { type: "implicit_presence" }))).toBe("already_open");
    expect(hashWorld(state)).toBe(before);
  });

  it("leaves acting while offline refused until it's on", () => {
    const state = world(false);
    act(state, "bob", { type: "leave" });
    const before = hashWorld(state);
    expect(code(act(state, "bob", { type: "move", dir: "n" }))).toBe("not_joined");
    expect(hashWorld(state)).toBe(before);
  });
});

describe("leave_idle", () => {
  it("takes everyone named offline in one input, with a left event each", () => {
    const state = world();
    const result = town(state, { type: "leave_idle", ids: ["ada", "bob"] });
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "left", residentId: "ada" },
        { type: "left", residentId: "bob" },
      ],
    });
    expect(state.residents.ada?.online).toBe(false);
    expect(state.residents.bob?.online).toBe(false);
  });

  it("refuses a resident, an empty list, a repeat, a stranger, or someone already offline", () => {
    const state = world();
    act(state, "bob", { type: "leave" });
    const before = hashWorld(state);
    expect(code(act(state, "ada", { type: "leave_idle", ids: ["ada"] }))).toBe("server_only");
    expect(code(town(state, { type: "leave_idle", ids: [] }))).toBe("unknown_resident");
    expect(code(town(state, { type: "leave_idle", ids: ["ada", "ada"] }))).toBe("unknown_resident");
    expect(code(town(state, { type: "leave_idle", ids: ["ada", "cy"] }))).toBe("unknown_resident");
    expect(code(town(state, { type: "leave_idle", ids: ["ada", "bob"] }))).toBe("not_joined");
    expect(code(town(state, { type: "leave_idle", ids: "ada" } as unknown as Command))).toBe(
      "unknown_resident",
    );
    expect(hashWorld(state)).toBe(before);
    expect(state.residents.ada?.online).toBe(true);
  });
});

describe("acting while offline, once presence comes with acting", () => {
  it("brings a known resident back in the same input, joined first", () => {
    const state = world();
    act(state, "bob", { type: "leave" });
    const seq = state.seq;
    const result = act(state, "bob", { type: "move", dir: "n" });
    expect(result).toMatchObject({
      ok: true,
      seq: seq + 1,
      events: [
        { type: "joined", resident: { id: "bob", online: true, x: 6, y: 6 } },
        { type: "moved", residentId: "bob", x: 6, y: 5 },
      ],
    });
    expect(state.residents.bob).toMatchObject({ online: true, x: 6, y: 5 });
  });

  it("makes the same world as a join and the action", () => {
    const implicit = world();
    const explicit = world();
    for (const state of [implicit, explicit]) act(state, "bob", { type: "leave" });
    act(implicit, "bob", { type: "move", dir: "e" });
    act(explicit, "bob", { type: "join", name: "bob", kind: "human" });
    act(explicit, "bob", { type: "move", dir: "e" });
    expect(implicit.residents).toEqual(explicit.residents);
  });

  it("moves them off a spot that was built on, as join does", () => {
    const state = world();
    // Ada claims plot (0,0) and stands on (1,1), Bob parks on (1,2) and leaves; Ada builds there.
    for (let i = 0; i < 4; i++) {
      for (const who of ["ada", "bob"]) {
        act(state, who, { type: "move", dir: "w" });
        act(state, who, { type: "move", dir: "n" });
      }
    }
    expect(act(state, "ada", { type: "claim" }).ok).toBe(true);
    act(state, "bob", { type: "move", dir: "w" });
    act(state, "bob", { type: "leave" });
    expect(act(state, "ada", { type: "place", x: 1, y: 2, block: "stone" }).ok).toBe(true);
    expect(rejoined(state, "bob")).toMatchObject({ ...spawnTile(CONFIG), online: true });
    const result = act(state, "bob", { type: "move", dir: "n" });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "joined", resident: spawnTile(CONFIG) }, { type: "moved" }],
    });
  });

  it("changes nothing when the action itself is refused", () => {
    const state = world();
    act(state, "bob", { type: "leave" });
    const before = hashWorld(state);
    expect(code(act(state, "bob", { type: "settle", px: 9, py: 9 }))).not.toBeNull();
    expect(hashWorld(state)).toBe(before);
    expect(state.residents.bob?.online).toBe(false);
  });

  it("checks with them back, but prepare alone changes nothing", () => {
    const state = world();
    act(state, "bob", { type: "leave" });
    const before = hashWorld(state);
    const prepared = prepare(state, { actor: "bob", command: { type: "move", dir: "n" } });
    expect(prepared.ok).toBe(true);
    expect(hashWorld(state)).toBe(before);
    expect(state.residents.bob?.online).toBe(false);
  });

  it("never brings back a stranger, and join and leave stay as they were", () => {
    const state = world();
    expect(code(act(state, "cy", { type: "move", dir: "n" }))).toBe("not_joined");
    expect(rejoined(state, "cy")).toBeUndefined();
    act(state, "bob", { type: "leave" });
    expect(code(act(state, "bob", { type: "leave" }))).toBe("not_joined");
    expect(act(state, "bob", { type: "join", name: "bob", kind: "human" })).toMatchObject({
      ok: true,
      events: [{ type: "joined" }],
    });
    expect(code(act(state, "bob", { type: "join", name: "bob", kind: "human" }))).toBe(
      "already_joined",
    );
  });
});

describe("asJoined", () => {
  it("is a view with an offline resident back, leaving the world as it was", () => {
    const state = world();
    act(state, "bob", { type: "leave" });
    const before = hashWorld(state);
    const view = asJoined(state, "bob");
    expect(view.residents.bob?.online).toBe(true);
    expect(state.residents.bob?.online).toBe(false);
    expect(hashWorld(state)).toBe(before);
    // Someone online, or a stranger, gets the world itself.
    expect(asJoined(state, "ada")).toBe(state);
    expect(asJoined(state, "cy")).toBe(state);
  });
});
