import type { Command, Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world with party games (RFC 0011). Eve, an agent, settles and waits three days so she
 * can play rated. Cy opens a table nobody joins and the server closes it. Ada, Dee, and Clem play
 * a slow Hearth race: picks that match block each other, Clem misses a round and plays the
 * default, and Ada reaches the hearth first. Ada and Dee move on the people ladder; Clem, with no
 * hearth, plays unrated. Then Bob, Eve, Dee, and Clem play five live rounds of Lowest lantern: Clem
 * misses two rounds in a row and is away until he decides again, Dee and Eve share first place,
 * Bob and Eve move on the agents ladder, and Dee finishing above Bob adds one to the people's side
 * of the tally. A new day starts the caps again.
 *
 * `games.test.ts` replays it and checks the hash pinned below, so a change to a game rule, the
 * ratings, or how a round closes that would replay the real log differently fails loudly.
 */
export const GAMES_CONFIG = BUILD_CONFIG;

const town = (command: Command): Input => ({ actor: TOWN_ACTOR, command });
const SALT_1 = "5b2f0c9e8a7d4c3b2a1908f7e6d5c4b3";
const SALT_2 = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const SALT_3 = "c0ffee00d00dfeedbeef0123456789ab";
/** The server's clock, in ms, around noon UTC on day 20023. */
const T = 20_023 * 86_400_000 + 12 * 3_600_000;

/** One round: each pick (`null` decides nothing), then the server closes it at `at`. */
function round(table: string, n: number, picks: [string, number | null][], at: number): Input[] {
  return [
    ...picks.flatMap(([actor, move]): Input[] =>
      move === null ? [] : [{ actor, command: { type: "decide", table, round: n, move } }],
    ),
    town({ type: "close_round", table, round: n, at }),
  ];
}

export const GAMES_LOG: Input[] = [
  ...BUILD_LOG,
  // Eve settles the plot east of the Commons, and three days later she may play rated.
  { actor: "eve", command: { type: "join", name: "Eve", kind: "agent" } },
  { actor: "eve", command: { type: "settle", px: 2, py: 1 } },
  { actor: "eve", command: { type: "build_starter_home" } },
  town({ type: "new_day", day: 20_023 }),
  // A table nobody joins closes.
  {
    actor: "cy",
    command: { type: "open_table", game: "lowest_lantern", pace: "slow", salt: SALT_3, at: T },
  },
  town({ type: "close_table", table: "g_1" }),
  // A slow Hearth race. Clem sits, stands, and sits again.
  {
    actor: "ada",
    command: { type: "open_table", game: "hearth_race", pace: "slow", salt: SALT_1, at: T + 1 },
  },
  { actor: "clem", command: { type: "sit", table: "g_2" } },
  { actor: "dee", command: { type: "sit", table: "g_2" } },
  { actor: "clem", command: { type: "stand", table: "g_2" } },
  { actor: "clem", command: { type: "sit", table: "g_2" } },
  { actor: "ada", command: { type: "start_game", table: "g_2", at: T + 60_000 } },
  // A live Lowest lantern opens at the next free spot while the race plays.
  {
    actor: "bob",
    command: {
      type: "open_table",
      game: "lowest_lantern",
      pace: "live",
      salt: SALT_2,
      at: T + 90_000,
    },
  },
  { actor: "eve", command: { type: "sit", table: "g_3" } },
  { actor: "dee", command: { type: "sit", table: "g_3" } },
  { actor: "clem", command: { type: "sit", table: "g_3" } },
  ...round(
    "g_2",
    1,
    [
      ["ada", 3],
      ["dee", 3],
      ["clem", 1],
    ],
    T + 120_000,
  ),
  ...round(
    "g_2",
    2,
    [
      ["dee", 2],
      ["ada", 3],
      ["clem", null],
    ],
    T + 180_000,
  ),
  ...round(
    "g_2",
    3,
    [
      ["ada", 3],
      ["clem", 3],
      ["dee", 2],
    ],
    T + 240_000,
  ),
  ...round(
    "g_2",
    4,
    [
      ["ada", 3],
      ["dee", 3],
      ["clem", 2],
    ],
    T + 300_000,
  ),
  ...round(
    "g_2",
    5,
    [
      ["ada", 3],
      ["dee", 2],
      ["clem", 1],
    ],
    T + 360_000,
  ),
  ...round(
    "g_2",
    6,
    [
      ["ada", 3],
      ["dee", 2],
      ["clem", 1],
    ],
    T + 420_000,
  ),
  ...round(
    "g_2",
    7,
    [
      ["ada", 3],
      ["dee", 2],
      ["clem", 1],
    ],
    T + 480_000,
  ),
  { actor: "bob", command: { type: "start_game", table: "g_3", at: T + 660_000 } },
  ...round(
    "g_3",
    1,
    [
      ["bob", 1],
      ["eve", 1],
      ["dee", 2],
      ["clem", 3],
    ],
    T + 700_000,
  ),
  ...round(
    "g_3",
    2,
    [
      ["bob", 1],
      ["eve", 2],
      ["dee", 1],
      ["clem", 4],
    ],
    T + 745_000,
  ),
  ...round(
    "g_3",
    3,
    [
      ["bob", 2],
      ["eve", 2],
      ["dee", 3],
      ["clem", null],
    ],
    T + 790_000,
  ),
  ...round(
    "g_3",
    4,
    [
      ["bob", 1],
      ["eve", 3],
      ["dee", 1],
      ["clem", null],
    ],
    T + 835_000,
  ),
  ...round(
    "g_3",
    5,
    [
      ["clem", 5],
      ["bob", 1],
      ["eve", 1],
      ["dee", 1],
    ],
    T + 880_000,
  ),
  town({ type: "new_day", day: 20_024 }),
];

/** `hashWorld(replay(GAMES_CONFIG, GAMES_LOG))`, pinned when party games landed. */
export const GAMES_HASH = "be0a7b3a";
