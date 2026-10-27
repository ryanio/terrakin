import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { NAME_RULE_WORDS, nameProblem } from "./names";
import { type Command, TOWN_ACTOR, type WorldState } from "./types";
import { createWorld } from "./world";

const CONFIG = { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 };

function world(): WorldState {
  const state = createWorld(CONFIG);
  const residents: [string, string][] = [
    ["ada", "dabid 2"],
    ["bo", "Bo"],
    ["cy", "Cy"],
  ];
  for (const [actor, name] of residents) {
    expect(apply(state, { actor, command: { type: "join", name, kind: "human" } }).ok).toBe(true);
  }
  apply(state, { actor: TOWN_ACTOR, command: { type: "set_townsfolk", ids: ["cy"] } });
  return state;
}

/** Refused with `code`, and the world is byte for byte what it was. */
function refused(state: WorldState, actor: string, command: Command, code: string) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? null : result.rejection.code).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

describe("the naming rule", () => {
  it("takes letters, digits and underscores, up to 24", () => {
    for (const name of [
      "cocoa",
      "musefelipe",
      "Vash05",
      "dabid_2",
      "user_5512",
      "_a",
      "7",
      "x".repeat(24),
    ]) {
      expect(nameProblem(name), name).toBeUndefined();
    }
  });

  it("refuses anything else, in the same words", () => {
    for (const name of [
      "",
      "<your",
      "Ada Lovelace",
      "Maypole #532",
      "___",
      "Zoë",
      "hi🌱",
      "a-b",
      "x".repeat(25),
    ]) {
      expect(nameProblem(name), name).toBe(NAME_RULE_WORDS);
    }
  });

  it("leaves a logged join's name alone, so old logs replay", () => {
    // `join` checks only the length: a name from before the rule still joins.
    expect(world().residents.ada?.name).toBe("dabid 2");
  });
});

describe("staff renaming a resident (rename_resident)", () => {
  it("refuses everyone but the town, and every bad rename, changing nothing", () => {
    const state = world();
    const rename = (resident: string, name: string): Command => ({
      type: "rename_resident",
      resident,
      name,
    });
    refused(state, "bo", rename("ada", "dabid_2"), "server_only");
    refused(state, TOWN_ACTOR, rename("nobody", "dabid_2"), "unknown_resident");
    refused(state, TOWN_ACTOR, rename("__proto__", "dabid_2"), "unknown_resident");
    refused(state, TOWN_ACTOR, rename("cy", "Cy_2"), "not_eligible");
    refused(state, TOWN_ACTOR, rename("ada", "dabid 2!"), "invalid_name");
    // A name that meets the rule stays: the notice would say otherwise.
    refused(state, TOWN_ACTOR, rename("bo", "Bo_2"), "not_eligible");
  });

  it("gives the resident the new name, with a public event", () => {
    const state = world();
    const result = apply(state, {
      actor: TOWN_ACTOR,
      command: { type: "rename_resident", resident: "ada", name: "dabid_2" },
    });
    expect(result.ok && result.events).toEqual([
      { type: "resident_renamed", residentId: "ada", name: "dabid_2" },
    ]);
    expect(state.residents.ada?.name).toBe("dabid_2");
  });
});
