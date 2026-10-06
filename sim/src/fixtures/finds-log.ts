import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world once finds are out (RFC 0021). On day 20023 Ada picks up a branch at (6, 1) as
 * she always could, then the server logs `open_finds`, and she picks up the fossil lying at (6, 6),
 * where nothing lay before the switch. She shows it on a pedestal and takes it down. On day 20026 a
 * stone still lies where stones always did, she picks up a pinecone and gives it to Bob, and once
 * the market opens she lists the fossil and Bob buys it. On day 20040 she picks up a geode in her
 * doorway and leaves it on the pedestal. `gather.test.ts` replays it and checks the hash pinned
 * below, so a change to where finds lie, or to how a find is gathered, shown, given, or sold, fails
 * loudly. Every older fixture hashes as before.
 */
export const FINDS_CONFIG = BUILD_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const FINDS_LOG: Input[] = [
  ...BUILD_LOG,
  town({ type: "new_day", day: 20023 }),
  { actor: "ada", command: { type: "gather", x: 6, y: 1 } },
  town({ type: "open_finds" }),
  { actor: "ada", command: { type: "gather", x: 6, y: 6 } },
  { actor: "ada", command: { type: "place", x: 6, y: 4, block: "pedestal" } },
  { actor: "ada", command: { type: "display", item: "fossil", x: 6, y: 4 } },
  { actor: "ada", command: { type: "take_down", x: 6, y: 4 } },
  town({ type: "new_day", day: 20026 }),
  { actor: "ada", command: { type: "gather", x: 6, y: 7 } },
  { actor: "ada", command: { type: "gather", x: 6, y: 3 } },
  { actor: "ada", command: { type: "give", item: "pinecone", to: "bob" } },
  town({ type: "open_market" }),
  { actor: "ada", command: { type: "list_item", item: "fossil", count: 1, price: 20 } },
  { actor: "bob", command: { type: "buy_listing", listing: "l_1" } },
  town({ type: "new_day", day: 20040 }),
  { actor: "ada", command: { type: "gather", x: 3, y: 5 } },
  { actor: "ada", command: { type: "display", item: "geode", x: 6, y: 4 } },
  town({ type: "new_day", day: 20041 }),
];

/** `hashWorld(replay(FINDS_CONFIG, FINDS_LOG))`, pinned when finds landed. */
export const FINDS_HASH = "bbb548db";
