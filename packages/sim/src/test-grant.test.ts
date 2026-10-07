import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { TEST_GRANT } from "./test-grant";
import { expectSupplyHolds } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld } from "./world";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function world() {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    expectSupplyHolds(state);
    return result;
  };
  const ok = (actor: string, command: Command) => {
    const result = send(actor, command);
    expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  return { state, ok, code };
}

function opened() {
  const w = world();
  w.ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  w.ok(TOWN_ACTOR, { type: "open_economy" });
  w.ok(TOWN_ACTOR, { type: "open_items" });
  w.ok("ada", { type: "join", name: "ada", kind: "human" });
  return w;
}

describe("test_grant", () => {
  it("moves coins out of the treasury and adds stacks, with private events", () => {
    const w = opened();
    const treasury = w.state.economy?.treasury ?? 0;
    const events = w.ok(TOWN_ACTOR, {
      type: "test_grant",
      to: "ada",
      coins: 250,
      stacks: { wood: 3, tomato_seed: 2 },
    });
    expect(w.state.economy?.coins.ada).toBe(250);
    expect(w.state.economy?.treasury).toBe(treasury - 250);
    expect(w.state.items?.inventories.ada?.stacks).toMatchObject({ wood: 3, tomato_seed: 2 });
    expect(events.map((e) => e.type)).toEqual(["treasury", "coins", "inventory"]);
    expect(events[1]).toMatchObject({ residentId: "ada", amount: 250, reason: "grant" });
  });

  it("comes only from the server", () => {
    const w = opened();
    expect(w.code("ada", { type: "test_grant", to: "ada", coins: 10 })).toBe("server_only");
  });

  it("refuses what it can't give whole", () => {
    const w = opened();
    const grant = (rest: Partial<Extract<Command, { type: "test_grant" }>>) =>
      w.code(TOWN_ACTOR, { type: "test_grant", to: "ada", ...rest });
    expect(grant({ to: "nobody", coins: 1 })).toBe("unknown_resident");
    expect(grant({ to: "__proto__", coins: 1 })).toBe("unknown_resident");
    expect(grant({})).toBe("invalid_amount");
    expect(grant({ coins: -1 })).toBe("invalid_amount");
    expect(grant({ coins: 1.5 })).toBe("invalid_amount");
    expect(grant({ coins: TEST_GRANT.coinsMax + 1 })).toBe("invalid_amount");
    expect(grant({ coins: (w.state.economy?.treasury ?? 0) + 1 })).toBe("not_enough_coins");
    expect(grant({ stacks: { dragon: 1 } })).toBe("unknown_item");
    expect(grant({ stacks: JSON.parse('{"__proto__": 1}') })).toBe("unknown_item");
    expect(grant({ stacks: { wood: 0 } })).toBe("invalid_amount");
    expect(grant({ stacks: { wood: TEST_GRANT.unitsMax + 1 } })).toBe("inventory_full");
  });

  it("waits for coins and items to open", () => {
    const w = world();
    w.ok("ada", { type: "join", name: "ada", kind: "human" });
    expect(w.code(TOWN_ACTOR, { type: "test_grant", to: "ada", coins: 1 })).toBe("economy_closed");
    expect(w.code(TOWN_ACTOR, { type: "test_grant", to: "ada", stacks: { wood: 1 } })).toBe(
      "items_closed",
    );
  });
});
