/**
 * Resident names ([issue #117](https://github.com/ryanio/terrakin/issues/117), decision 0379): 1 to
 * `NAME_MAX_LENGTH` ASCII letters, digits and underscores, with at least one letter or digit, so
 * "Juniper", "Vash05" and "dabid_2" are names and "<your", "Ada Lovelace" and "___" are not.
 *
 * `join` checks only the length, because logged joins hold names from before the rule ("dabid 2")
 * and must replay as they were made. A new name meets the rule at the API, whose `ResidentName`
 * schema reads `NAME_PATTERN`, and in the server's `createResident`. `rename_resident` is new, so it
 * checks the whole rule here.
 */
import { refuse } from "./check";
import { isTownsfolk } from "./economy";
import { residentById } from "./own";
import type { Command, Rejection, WorldEvent, WorldState } from "./types";

export const NAME_MAX_LENGTH = 24;

/** What a name may hold: letters, digits and underscores, and at least one letter or digit. */
export const NAME_PATTERN = /^(?=[A-Za-z0-9_]*[A-Za-z0-9])[A-Za-z0-9_]+$/;

/** The rule in words, for every refusal of a name. */
export const NAME_RULE_WORDS = `Names use only letters, numbers, and underscores, up to ${NAME_MAX_LENGTH} characters, like Juniper or Juniper_2.`;

/** Why `name` can't be a resident's name, in words, or undefined when it can. */
export function nameProblem(name: string): string | undefined {
  if (name.length < 1 || name.length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) {
    return NAME_RULE_WORDS;
  }
  return undefined;
}

/**
 * `rename_resident {resident, name}` (staff, through the server): a resident whose name breaks the
 * rule, from before it, takes `name`, which must meet the whole rule. The server checks first that
 * nobody else has it, as a join does. Townsfolk keep the names the town gave them.
 */
export function checkRenameResident(
  state: WorldState,
  command: Extract<Command, { type: "rename_resident" }>,
): (() => WorldEvent[]) | Rejection {
  const resident = residentById(state, command.resident);
  if (!resident) return refuse("unknown_resident", "There's no such resident.");
  if (isTownsfolk(state, resident.id)) {
    return refuse("not_eligible", "Townsfolk keep the names the town gave them.");
  }
  // Only a name from before the rule that breaks it: the notice tells them that's why.
  if (nameProblem(resident.name) === undefined) {
    return refuse("not_eligible", "Their name already meets the naming rule.");
  }
  const problem = nameProblem(command.name);
  if (problem) return refuse("invalid_name", problem);
  const { name } = command;
  return () => {
    resident.name = name;
    return [{ type: "resident_renamed", residentId: resident.id, name }];
  };
}
