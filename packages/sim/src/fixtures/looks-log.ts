import type { Input } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world after garment styles (decision 0053): a wear list sent out of slot order, styles
 * set on several garments, one changed on its own, one cleared with null, a garment in the
 * resident's own pattern, and every style cleared at once. `looks.test.ts` replays it and checks
 * the hash pinned below, so a change to how styles merge or serialize fails loudly.
 */
export const LOOKS_CONFIG = SHOP_CONFIG;

export const LOOKS_LOG: Input[] = [
  ...SHOP_LOG,
  { actor: "ada", command: { type: "profile", wear: ["socks", "dress", "straw_hat"] } },
  {
    actor: "ada",
    command: {
      type: "profile",
      wearStyle: {
        socks: { pattern: "stripes" },
        dress: { color: "sun", pattern: "citrus" },
        straw_hat: { color: "rose" },
      },
    },
  },
  { actor: "ada", command: { type: "profile", wearStyle: { socks: { color: "sky" } } } },
  { actor: "ada", command: { type: "profile", wearStyle: { straw_hat: null } } },
  {
    actor: "bob",
    command: {
      type: "profile",
      patternMedia: "m_00000000000000ab",
      wear: ["umbrella", "skirt"],
      wearStyle: { skirt: { pattern: "own" } },
    },
  },
  { actor: "bob", command: { type: "profile", wearStyle: null } },
  { actor: "bob", command: { type: "profile", wearStyle: { skirt: { color: "plum" } } } },
];

/** `hashWorld(replay(LOOKS_CONFIG, LOOKS_LOG))`, pinned when garment styles landed. */
export const LOOKS_HASH = "1ab83e58";
