import { describe, expect, it } from "vitest";
import {
  AdoptPetAction,
  type RoutineView,
  SetRoutinesAction,
} from "../../packages/protocol/src/index";
import { Moderation } from "../../packages/server/src/moderation.ts";
import { checkPersonas, PERSONAS, type Persona } from "./personas.ts";
import { type PetChoice, planPet } from "./pet-plan.ts";
import { planRoutines } from "./routine-plan.ts";

const WANT: RoutineView[] = [
  { kind: "walk_home", hour: 18 },
  { kind: "stroll", hour: 7 },
  { kind: "greet", max: 2 },
];
const THISTLE: PetChoice = { kind: "hedgehog", coat: "brown", name: "Thistle" };

describe("the townsfolk's routines and pets", () => {
  it("are what the API takes, with pet names that pass the edge filters", () => {
    // No townsfolk privilege, so each name would pass for any resident.
    const filters = new Moderation();
    for (const p of PERSONAS) {
      expect(
        SetRoutinesAction.safeParse({ type: "set_routines", routines: p.routines }).success,
        p.name,
      ).toBe(true);
      expect(AdoptPetAction.safeParse({ type: "adopt_pet", ...p.pet }).success, p.name).toBe(true);
      expect(filters.review("pet_name", p.pet.name).ok, p.name).toBe(true);
    }
  });

  it("are checked before anything is sent", () => {
    const [first] = PERSONAS;
    if (!first) throw new Error("no personas");
    const problems = (change: Partial<Persona>) =>
      checkPersonas([{ ...first, ...change }]).join("\n");
    expect(problems({ routines: [{ kind: "stroll", hour: 7 }] })).toMatch(/needs a walk_home/);
    expect(
      problems({
        routines: [
          { kind: "greet", max: 2 },
          { kind: "greet", max: 3 },
        ],
      }),
    ).toMatch(/two greet routines/);
    expect(problems({ routines: [{ kind: "walk_home", hour: 24 }] })).toMatch(/from 0 to 23/);
    expect(problems({ pet: { ...THISTLE, name: "Thistle the Second Jr" } })).toMatch(/pet's name/);
    expect(problems({ pet: { ...THISTLE, name: "Little  Thistle" } })).toMatch(/clean up/);
  });
});

describe("planRoutines", () => {
  it("sends the whole list when none are on", () => {
    expect(planRoutines(WANT, [])).toMatchObject({
      kind: "set",
      action: { type: "set_routines", routines: WANT },
    });
  });

  it("sends nothing when the server has the same routines in its own order", () => {
    const current: RoutineView[] = [
      { kind: "greet", max: 2 },
      { kind: "walk_home", hour: 18 },
      { kind: "stroll", hour: 7 },
    ];
    expect(planRoutines(WANT, current)).toEqual({ kind: "done", routines: current });
  });

  it("sends the whole list again when an hour differs or another routine is on", () => {
    const moved: RoutineView[] = [
      { kind: "walk_home", hour: 9 },
      { kind: "stroll", hour: 7 },
      { kind: "greet", max: 2 },
    ];
    const set = { kind: "set", action: { type: "set_routines", routines: WANT } };
    expect(planRoutines(WANT, moved)).toMatchObject(set);
    expect(planRoutines(WANT.slice(0, 2), WANT)).toMatchObject({
      kind: "set",
      action: { type: "set_routines", routines: WANT.slice(0, 2) },
    });
  });
});

describe("planPet", () => {
  it("adopts when there's no pet", () => {
    expect(planPet(THISTLE, undefined)).toMatchObject({
      kind: "adopt",
      action: { type: "adopt_pet", kind: "hedgehog", coat: "brown", name: "Thistle" },
    });
  });

  it("sends nothing when they have it", () => {
    expect(planPet(THISTLE, { ...THISTLE })).toMatchObject({ kind: "done" });
  });

  it("renames the same kind and coat under another name", () => {
    expect(planPet(THISTLE, { ...THISTLE, name: "Spike" })).toMatchObject({
      kind: "rename",
      action: { type: "rename_pet", name: "Thistle" },
    });
  });

  it("never adopts a second pet or changes one it can't", () => {
    // Another kind, another coat (a new coat costs coins townsfolk can't spend), or a name staff
    // are holding back: nothing is sent.
    for (const has of [
      { kind: "cat", coat: "ginger", name: "Thistle" },
      { kind: "hedgehog", coat: "grey", name: "Thistle" },
      { ...THISTLE, name: "" },
    ] as const) {
      expect(planPet(THISTLE, has), JSON.stringify(has)).toMatchObject({ kind: "keep" });
    }
  });
});
