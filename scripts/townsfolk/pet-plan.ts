/**
 * What to do about one townsfolk resident's pet (RFC 0019), from the `pet` on its profile. Pure, so
 * the tests feed it fixtures; seed.ts does the reading and the writing. A pet is for good, so the
 * plan adopts only when there's no pet at all.
 */
import type { Action, PetView } from "../../packages/protocol/src/index";
import type { PET_COATS, PetKind } from "../../packages/sim/src/index";

/** A pet as the seed adopts it: a kind, one of that kind's coats, and a name. */
export type PetChoice = {
  [K in PetKind]: { kind: K; coat: (typeof PET_COATS)[K][number]; name: string };
}[PetKind];

type Pet = Pick<PetView, "kind" | "coat" | "name">;

/** What a pet step should do. */
export type PetStep =
  /** They have it: the same kind, coat, and name. Nothing to send. */
  | { kind: "done"; pet: Pet }
  /** No pet yet: adopt it. */
  | { kind: "adopt"; want: PetChoice; action: Extract<Action, { type: "adopt_pet" }> }
  /** The persona's kind and coat under another name: rename it, free once a UTC day. */
  | { kind: "rename"; has: Pet; action: Extract<Action, { type: "rename_pet" }> }
  /**
   * Another kind or coat, or a name staff are holding back (`""`). A pet is for good, and townsfolk
   * can't pay for a new coat (`groom_pet` refuses them), so it stays as it is. Nothing to send.
   */
  | { kind: "keep"; has: Pet; want: PetChoice };

/** `want` is the persona's pet, `current` the `pet` on its profile now (absent before adopting). */
export function planPet(want: PetChoice, current: Pet | undefined): PetStep {
  if (!current) {
    return {
      kind: "adopt",
      want,
      action: { type: "adopt_pet", kind: want.kind, coat: want.coat, name: want.name },
    };
  }
  if (current.kind !== want.kind || current.coat !== want.coat || current.name === "") {
    return { kind: "keep", has: current, want };
  }
  if (current.name === want.name) return { kind: "done", pet: current };
  return { kind: "rename", has: current, action: { type: "rename_pet", name: want.name } };
}

/** "a brown hedgehog", "an amber tortoise". */
const kindOf = (pet: Pet) => `${/^[aeiou]/.test(pet.coat) ? "an" : "a"} ${pet.coat} ${pet.kind}`;

/** A pet in plain words: "Thistle, a brown hedgehog". */
export const describePet = (pet: Pet) => `${pet.name}, ${kindOf(pet)}`;

/** One line for the run's output. Names only, never a token. */
export function describePetStep(step: PetStep, send: boolean): string {
  switch (step.kind) {
    case "done":
      return `pet: has ${describePet(step.pet)}`;
    case "adopt":
      return `pet: none yet, ${send ? "adopting" : "would adopt"} ${describePet(step.want)}`;
    case "rename":
      return `pet: ${kindOf(step.has)} called ${step.has.name}, ${send ? "renaming" : "would rename"} it ${step.action.name}`;
    case "keep":
      return step.has.name === ""
        ? `pet: ${kindOf(step.has)} whose name staff are holding back; left as it is`
        : `pet: has ${describePet(step.has)} where the cast says ${describePet(step.want)}; a pet is for good and townsfolk can't buy a new coat, so it stays`;
  }
}
