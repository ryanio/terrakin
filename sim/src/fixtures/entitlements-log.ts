import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { LOOKS_CONFIG, LOOKS_LOG } from "./looks-log";

/**
 * The looks world after partner wear (RFC 0007 phase 3): Ada is entitled to the muse halo and puts
 * it on with a style of its own, a promo adds the muse lantern and she carries it, the promo ends
 * and the lantern comes off with it, and Bob's entitlement comes and goes before he wears
 * anything. `entitlements.test.ts` replays it and checks the hash pinned below, so a change to how
 * entitlements merge, sort, or take wear off fails loudly. Every older fixture hashes as before.
 */
export const ENTITLEMENTS_CONFIG = LOOKS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const ENTITLEMENTS_LOG: Input[] = [
  ...LOOKS_LOG,
  town({ type: "set_entitlements", residentId: "ada", items: ["muse_halo"] }),
  {
    actor: "ada",
    command: {
      type: "profile",
      wear: ["muse_halo", "dress", "socks"],
      wearStyle: { muse_halo: { color: "plum" } },
    },
  },
  town({ type: "set_entitlements", residentId: "ada", items: ["muse_lantern", "muse_halo"] }),
  {
    actor: "ada",
    command: { type: "profile", wear: ["muse_halo", "dress", "socks", "muse_lantern"] },
  },
  town({ type: "set_entitlements", residentId: "ada", items: ["muse_halo"] }),
  town({ type: "set_entitlements", residentId: "bob", items: ["muse_halo"] }),
  town({ type: "set_entitlements", residentId: "bob", items: [] }),
];

/** `hashWorld(replay(ENTITLEMENTS_CONFIG, ENTITLEMENTS_LOG))`, pinned when partner wear landed. */
export const ENTITLEMENTS_HASH = "4f753782";
