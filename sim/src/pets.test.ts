import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { MARKET_CONFIG, MARKET_LOG } from "./fixtures/market-log";
import { PETS_CONFIG, PETS_HASH, PETS_LOG } from "./fixtures/pets-log";
import { hashWorld } from "./hash";
import { tileKey } from "./keys";
import { petBed } from "./pet-art";
import { PETS, treatedToday } from "./pets";
import { replay } from "./replay";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, type RejectionCode, TOWN_ACTOR, type WorldState } from "./types";
import { groundOf } from "./walk";
import { createWorld, DEFAULT_CONFIG } from "./world";

function act(state: WorldState, actor: string, command: Command) {
  const result = apply(state, { actor, command });
  if (!result.ok) throw new Error(`${actor} ${command.type}: ${result.rejection.message}`);
  return result.events;
}

/**
 * Everyone with a hearth goes home and collects the day's allowance and pantry, so the events a
 * test checks next are only its own.
 */
function collect(state: WorldState) {
  for (const r of Object.values(state.residents))
    if (r.hearth) apply(state, { actor: r.id, command: { type: "home" } });
}

/** The market world (coins, items, and the shop open, homes with hearths), today's due collected. */
function market(): WorldState {
  const state = replay(MARKET_CONFIG, MARKET_LOG);
  collect(state);
  return state;
}

/** The next day, collected. */
function nextDay(state: WorldState) {
  act(state, TOWN_ACTOR, { type: "new_day", day: (state.day ?? 0) + 1 });
  collect(state);
}

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

const adopt = (name = "Biscuit"): Command => ({
  type: "adopt_pet",
  kind: "cat",
  coat: "ginger",
  name,
});

describe("adopting a pet", () => {
  it("brings it home on the resident, says so to everyone, and it stays through leaving", () => {
    const state = market();
    const events = act(state, "ada", adopt());
    const pet = { kind: "cat", coat: "ginger", name: "Biscuit", adoptedDay: state.day };
    expect(events).toEqual([{ type: "pet_adopted", residentId: "ada", pet }]);
    expect(state.residents.ada?.pet).toEqual(pet);

    act(state, "ada", { type: "leave" });
    const back = act(state, "ada", { type: "join", name: "Ada", kind: "human" });
    expect(back).toEqual([expect.objectContaining({ type: "joined" })]);
    expect(back[0]).toMatchObject({ resident: { pet } });
    expect(state.residents.ada?.pet).toEqual(pet);
  });

  it("comes back with an offline owner whose own command brings them back", () => {
    const state = market();
    act(state, "ada", adopt());
    act(state, TOWN_ACTOR, { type: "implicit_presence" });
    act(state, TOWN_ACTOR, { type: "leave_idle", ids: ["ada"] });
    const events = act(state, "ada", { type: "rename_pet", name: "Bun" });
    expect(events.map((e) => e.type)).toEqual(["joined", "pet_renamed"]);
    expect(state.residents.ada?.pet).toMatchObject({ kind: "cat", name: "Bun" });
  });

  it("refuses an unknown kind, another kind's coat, a bad name, a second pet, and no hearth", () => {
    const state = market();
    const unknown = (command: object) => command as unknown as Command;
    refused(state, "ada", unknown({ ...adopt(), kind: "dragon" }), "invalid_pet");
    refused(state, "ada", unknown({ ...adopt(), coat: "mallard" }), "invalid_pet");
    refused(state, "ada", adopt("   "), "invalid_pet");
    refused(state, "ada", adopt("x".repeat(PETS.nameMax + 1)), "invalid_pet");
    // Clem has no hearth.
    refused(state, "clem", adopt(), "no_hearth");
    act(state, "ada", adopt("  Biscuit  "));
    expect(state.residents.ada?.pet?.name).toBe("Biscuit");
    refused(
      state,
      "ada",
      { type: "adopt_pet", kind: "dog", coat: "golden", name: "Rex" },
      "already_have",
    );
  });
});

describe("renaming a pet", () => {
  it("is free, once a UTC day, except that a new pet can be renamed at once", () => {
    const state = market();
    refused(state, "ada", { type: "rename_pet", name: "Bun" }, "no_pet");
    act(state, "ada", adopt("Biscut"));
    expect(act(state, "ada", { type: "rename_pet", name: "Biscuit" })).toEqual([
      { type: "pet_renamed", residentId: "ada", name: "Biscuit" },
    ]);
    refused(state, "ada", { type: "rename_pet", name: "Bun" }, "pet_limit");
    nextDay(state);
    refused(state, "ada", { type: "rename_pet", name: "Biscuit" }, "invalid_pet");
    refused(state, "ada", { type: "rename_pet", name: "" }, "invalid_pet");
    // No coins move: the only event is the rename.
    expect(act(state, "ada", { type: "rename_pet", name: "Bun" })).toEqual([
      { type: "pet_renamed", residentId: "ada", name: "Bun" },
    ]);
    expect(state.residents.ada?.pet).toMatchObject({ name: "Bun", renamedDay: state.day });
  });
});

describe("grooming a pet", () => {
  it(`burns ${PETS.groomFee} coins for a new coat, and the supply still adds up`, () => {
    const state = market();
    act(state, "ada", adopt());
    const coins = state.economy?.coins.ada ?? 0;
    const burned = state.economy?.burned ?? 0;
    const treasury = state.economy?.treasury;
    expect(act(state, "ada", { type: "groom_pet", coat: "calico" })).toEqual([
      { type: "pet_groomed", residentId: "ada", coat: "calico" },
      {
        type: "coins",
        residentId: "ada",
        amount: -PETS.groomFee,
        balance: coins - PETS.groomFee,
        reason: "groom",
      },
    ]);
    expect(state.residents.ada?.pet?.coat).toBe("calico");
    expect(state.economy?.burned).toBe(burned + PETS.groomFee);
    expect(state.economy?.treasury).toBe(treasury);
    expectSupplyHolds(state);
  });

  it("refuses without the coins, and changes nothing", () => {
    const state = market();
    act(state, "cy", { type: "adopt_pet", kind: "fox", coat: "red", name: "Ember" });
    // Cy has a day's allowance, short of a new coat.
    const have = state.economy?.coins.cy ?? 0;
    expect(have).toBeLessThan(PETS.groomFee - 1);
    refused(state, "cy", { type: "groom_pet", coat: "arctic" }, "not_enough_coins");
    fund(state, "cy", PETS.groomFee - 1 - have);
    refused(state, "cy", { type: "groom_pet", coat: "arctic" }, "not_enough_coins");
    fund(state, "cy", 1);
    act(state, "cy", { type: "groom_pet", coat: "arctic" });
    expect(state.economy?.coins.cy).toBeUndefined();
    expectSupplyHolds(state);
  });

  it("refuses no pet, another kind's coat, the same coat, and townsfolk", () => {
    const state = market();
    refused(state, "ada", { type: "groom_pet", coat: "tabby" }, "no_pet");
    act(state, "ada", adopt());
    refused(state, "ada", { type: "groom_pet", coat: "golden" }, "invalid_pet");
    refused(state, "ada", { type: "groom_pet", coat: "ginger" }, "invalid_pet");
    // Townsfolk keep their coins for the town.
    act(state, TOWN_ACTOR, { type: "set_townsfolk", ids: ["ada"] });
    fund(state, "ada", 100);
    refused(state, "ada", { type: "groom_pet", coat: "tabby" }, "not_eligible");
  });

  it("refuses while coins are closed", () => {
    const state = createWorld(DEFAULT_CONFIG);
    act(state, "ada", { type: "join", name: "Ada", kind: "human" });
    act(state, "ada", { type: "settle", px: 0, py: 0 });
    act(state, "ada", { type: "build_starter_home" });
    act(state, "ada", adopt());
    // A world with no day yet: nothing records a day, and a rename has no daily limit.
    expect(state.residents.ada?.pet).toEqual({ kind: "cat", coat: "ginger", name: "Biscuit" });
    refused(state, "ada", { type: "groom_pet", coat: "tabby" }, "economy_closed");
    act(state, "ada", { type: "rename_pet", name: "Bun" });
    act(state, "ada", { type: "rename_pet", name: "Biscuit" });
    expect(state.residents.ada?.pet).toEqual({ kind: "cat", coat: "ginger", name: "Biscuit" });
  });
});

describe("treats", () => {
  it("take one of the giver's produce, and keep the pet happy for the rest of the day", () => {
    const state = market();
    act(state, "bob", { type: "adopt_pet", kind: "tortoise", coat: "olive", name: "Shelly" });
    stock(state, "ada", { strawberry: 2 });
    const day = state.day ?? 0;
    expect(act(state, "ada", { type: "treat_pet", owner: "bob", item: "strawberry" })).toEqual([
      { type: "pet_treated", residentId: "bob", by: "ada", kind: "strawberry" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "treat",
        changes: [{ kind: "strawberry", amount: -1, count: 1 }],
        with: "bob",
      },
    ]);
    const pet = state.residents.bob?.pet;
    expect(pet).toMatchObject({ treat: { day, by: "ada", kind: "strawberry" } });
    expect(pet && treatedToday(pet, day)).toBe(true);
    // One a day, from anyone.
    stock(state, "bob", { strawberry: 1 });
    refused(state, "bob", { type: "treat_pet", owner: "bob", item: "strawberry" }, "pet_limit");
    nextDay(state);
    expect(pet && treatedToday(pet, day + 1)).toBe(false);
    // An owner may treat their own pet.
    const own = act(state, "bob", { type: "treat_pet", owner: "bob", item: "strawberry" });
    expect(own[1]).toEqual({
      type: "inventory",
      residentId: "bob",
      reason: "treat",
      changes: [{ kind: "strawberry", amount: -1, count: 0 }],
    });
  });

  it("refuse someone unknown, no pet, what isn't produce, and what you don't hold", () => {
    const state = market();
    stock(state, "ada", { strawberry: 1 });
    refused(
      state,
      "ada",
      { type: "treat_pet", owner: "nobody", item: "strawberry" },
      "unknown_resident",
    );
    refused(state, "ada", { type: "treat_pet", owner: "bob", item: "strawberry" }, "no_pet");
    act(state, "bob", { type: "adopt_pet", kind: "duck", coat: "yellow", name: "Pip" });
    refused(
      state,
      "ada",
      { type: "treat_pet", owner: "bob", item: "sugar" } as unknown as Command,
      "unknown_item",
    );
    refused(state, "ada", { type: "treat_pet", owner: "bob", item: "tomato" }, "not_enough_items");
  });

  it("wait for items to open", () => {
    const state = createWorld(DEFAULT_CONFIG);
    act(state, "ada", { type: "join", name: "Ada", kind: "human" });
    act(state, "ada", { type: "settle", px: 0, py: 0 });
    act(state, "ada", { type: "build_starter_home" });
    act(state, "ada", adopt());
    refused(state, "ada", { type: "treat_pet", owner: "ada", item: "lemon" }, "items_closed");
  });
});

describe("the pets log", () => {
  it("replays to the hash pinned when pets landed", () => {
    const state = replay(PETS_CONFIG, PETS_LOG);
    expect(state.residents.ada?.pet).toMatchObject({
      kind: "cat",
      coat: "tabby",
      name: "Biscuit the Brave",
      treat: { by: "bob", kind: "strawberry" },
    });
    expect(state.residents.bob?.pet).toMatchObject({ kind: "tortoise", name: "Shelly" });
    expectSupplyHolds(state);
    expect(hashWorld(state)).toBe(PETS_HASH);
  });
});

describe("where a pet sleeps", () => {
  it("is the first open tile east, west, south, or north of the hearth, else the hearth", () => {
    const hearth = { x: 3, y: 3 };
    const bed = (...blocked: [number, number][]) =>
      petBed(
        groundOf({
          config: DEFAULT_CONFIG,
          hasBlock: (x, y) => blocked.some(([bx, by]) => tileKey(bx, by) === tileKey(x, y)),
          solidBuildings: false,
          shopOpen: false,
        }),
        hearth,
      );
    expect(bed()).toEqual({ x: 4, y: 3 });
    expect(bed([4, 3])).toEqual({ x: 2, y: 3 });
    expect(bed([4, 3], [2, 3])).toEqual({ x: 3, y: 4 });
    expect(bed([4, 3], [2, 3], [3, 4], [3, 2])).toEqual(hearth);
  });
});
