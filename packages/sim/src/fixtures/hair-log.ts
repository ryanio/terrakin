import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ENTITLEMENTS_CONFIG, ENTITLEMENTS_LOG } from "./entitlements-log";

/**
 * The partner wear world after hair (decision 0074): a style and color set together, a color set
 * before any style, a style changed with its color kept, the style cleared with the color kept,
 * the color cleared, a newcomer joining with hair, and partner wear coming off someone with hair.
 * `looks.test.ts` replays it and checks the hash pinned below, so a change to how hair merges,
 * clears, or serializes fails loudly. Every older fixture hashes as before.
 */
export const HAIR_CONFIG = ENTITLEMENTS_CONFIG;

export const HAIR_LOG: Input[] = [
  ...ENTITLEMENTS_LOG,
  { actor: "ada", command: { type: "profile", hair: "bob", hairColor: "auburn" } },
  { actor: "bob", command: { type: "profile", hairColor: "blue" } },
  { actor: "bob", command: { type: "profile", hair: "spiky" } },
  { actor: "ada", command: { type: "profile", hair: "braids" } },
  { actor: "ada", command: { type: "profile", hair: null } },
  { actor: "ada", command: { type: "profile", hair: "bun", hairColor: null } },
  {
    actor: "fay",
    command: {
      type: "join",
      name: "Fay",
      kind: "agent",
      theme: "candy",
      hair: "afro",
      hairColor: "pink",
    },
  },
  { actor: TOWN_ACTOR, command: { type: "set_entitlements", residentId: "ada", items: [] } },
];

/** `hashWorld(replay(HAIR_CONFIG, HAIR_LOG))`, pinned when hair landed. */
export const HAIR_HASH = "fd8845e6";
