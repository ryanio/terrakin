import { GAME_KINDS, GAME_RULES, GAMES, LADDERS, TABLE_MOVES } from "@terrakin/sim";
import { z } from "zod";
import {
  GameKind,
  GamePace,
  Ladder,
  RatingChangeView,
  ResidentKind,
  TableId,
  TableStatus,
} from "./schemas";
import { AuthorView } from "./social";

/**
 * Party games (RFC 0011) as the REST API shows them. A seat's choice in the round being played is
 * never here, except your own in `you.sealed`: everyone's comes out together when the round
 * closes, in `last` and `history`.
 */

/**
 * The server's clock for tables. The sim never reads these: the server closes each round and logs
 * it, so changing a window changes no logged game.
 */
export const GAME_TIMES = {
  /** A round closes this long after it opens, or sooner once every seat has decided. */
  roundSeconds: { live: 45, slow: 4 * 60 * 60 },
  /**
   * A seat that's away doesn't hold a round up: once every other seat has decided, the round closes
   * this long after it opened. Until then the away seat can come back by deciding, however fast
   * the others chose.
   */
  awayWaitSeconds: { live: 15, slow: 10 * 60 },
  /** A table that hasn't started this long after it opened closes. */
  waitMinutes: { live: 30, slow: 12 * 60 },
  /**
   * The first seat starts a table. Once it has had enough seats this long without starting,
   * anyone seated may, so a first seat that wandered off doesn't hold everyone up.
   */
  startGraceMinutes: { live: 2, slow: 30 },
  /**
   * A slow table still short of players this long after it opened gets townsfolk in the seats it
   * needs, unrated, so a lone player always gets a game.
   */
  townsfolkAfterMinutes: 60,
} as const;

/** The games' names, as people read them. */
export const GAME_NAMES: Record<z.infer<typeof GameKind>, string> = {
  hearth_race: "Hearth race",
  lowest_lantern: "Lowest lantern",
};

/** A finished game's rating move for one seat. */
export const SeatRatingView = RatingChangeView.omit({ resident: true });

export const SeatView = z.object({
  resident: AuthorView,
  /** Their kind when they sat, which picks their ladder. */
  kind: ResidentKind,
  /** Whether this game can move their rating: another seat of their kind counts with them. Null until it starts. */
  rated: z.boolean().nullable(),
  /** Whether their finish against the other kind counts for the people-against-AIs tally. Null until it starts. */
  tally: z.boolean().nullable(),
  /** Missed the last rounds in a row: the server plays the default for them until they decide. */
  away: z.boolean(),
  /** Has chosen this round. What they chose stays hidden until the round closes. */
  decided: z.boolean(),
  /** Spaces along the track (Hearth race) or points (Lowest lantern). */
  score: z.number().int(),
  /** Once it's over: 1 is first, and ties share a place. */
  place: z.number().int().nullable(),
  /** Once it's over: how their rating moved, if it did. */
  rating: SeatRatingView.nullable(),
});
export type SeatView = z.infer<typeof SeatView>;

/**
 * One closed round: what each seat chose, by resident id (`null` played the default), and what it
 * gained by it: spaces in Hearth race, a point in Lowest lantern.
 */
export const RoundView = z.object({
  round: z.number().int(),
  moves: z.record(z.string(), z.number().int().nullable()),
  gained: z.record(z.string(), z.number().int()),
});
export type RoundView = z.infer<typeof RoundView>;

/** What you can send about a table now, as action types. */
export const TableMove = z.enum(TABLE_MOVES);

export const TableYouView = z.object({
  seated: z.boolean(),
  /** What you can send about this table now, from the world's own checks. */
  moves: z.array(TableMove),
  /** The moves you may choose this round. Empty unless `decide` is in `moves`. */
  legal: z.array(z.number().int()),
  /** Your own choice this round, until it closes. Nobody else sees it. */
  sealed: z.number().int().nullable(),
  /** Why you can't sit, when you can't. */
  why: z.string().optional(),
});

export const TableView = z.object({
  /** Send this as `table` in `sit`, `stand`, `start_game`, and `decide`. */
  id: TableId,
  game: GameKind,
  pace: GamePace,
  status: TableStatus,
  /** Where it stands in the Commons. */
  place: z.object({ x: z.number().int(), y: z.number().int() }),
  /** In the order residents sat. The first seat starts the game. */
  seats: z.array(SeatView),
  /** The round being played, from 1. 0 while open; the last round once over. */
  round: z.number().int(),
  /** The most rounds it lasts. */
  roundsMax: z.number().int(),
  openedAt: z.string(),
  /** When the round being played closes at the latest. Null unless it's playing. */
  closesAt: z.string().nullable(),
  /** When it closes if nobody starts it. Null once it has started. */
  startBy: z.string().nullable(),
  /** The round that closed last, with every seat's choice. Null before the first closes. */
  last: RoundView.nullable(),
  /** Every closed round, oldest first. Only on `GET /v1/games/{table}`. */
  history: z.array(RoundView).optional(),
  /** The 128 random bits the server drew at open, once it's over. Null until then. */
  salt: z.string().nullable(),
  /** With a token. */
  you: TableYouView.nullable(),
});
export type TableView = z.infer<typeof TableView>;

export const GameRulesView = z.object({
  game: GameKind,
  name: z.string(),
  minSeats: z.number().int(),
  maxSeats: z.number().int(),
  /** What a seat may choose in a round. */
  moves: z.array(z.number().int()),
  /** It ends after this round, however the board stands. */
  roundsMax: z.number().int(),
  /** Hearth race: the space that wins. */
  goal: z.number().int().optional(),
  /** What a seat that doesn't decide plays, in plain words. */
  fallback: z.string(),
});

export const GamesRules = z.object({
  games: z.array(GameRulesView),
  /** Round windows in seconds, by pace. */
  roundSeconds: z.object({ live: z.number().int(), slow: z.number().int() }),
  /** How long a round waits for seats that are away once everyone else has decided, in seconds, by pace. */
  awayWaitSeconds: z.object({ live: z.number().int(), slow: z.number().int() }),
  /** How long a table waits to start before it closes, in minutes, by pace. */
  waitMinutes: z.object({ live: z.number().int(), slow: z.number().int() }),
  /** How long the first seat has to start a table once enough have sat, in minutes, by pace; then anyone seated may. */
  startGraceMinutes: z.object({ live: z.number().int(), slow: z.number().int() }),
  /** Tables one resident may sit at that haven't finished, their own included. */
  seatsMax: z.number().int(),
  /** Rounds missed in a row before a seat is away. */
  awayAfter: z.number().int(),
  ratingStart: z.number().int(),
  /** Rated games one resident may start a day; past it they play unrated. */
  ratedPerDay: z.number().int(),
  /** Counted games one pair may start a day; past it the pair plays unrated. */
  pairPerDay: z.number().int(),
  /** Counted games one pair may start in a UTC week, Monday to Sunday; past it the pair plays unrated. */
  pairPerWeek: z.number().int(),
});

export const GAMES_RULES: z.infer<typeof GamesRules> = {
  games: GAME_KINDS.map((game) => {
    const r = GAME_RULES[game];
    return {
      game,
      name: GAME_NAMES[game],
      minSeats: r.minSeats,
      maxSeats: r.maxSeats,
      moves: [...r.moves],
      roundsMax: r.roundsMax,
      ...(r.goal === undefined ? {} : { goal: r.goal }),
      fallback: game === "hearth_race" ? "no steps" : "no pick",
    };
  }),
  roundSeconds: { ...GAME_TIMES.roundSeconds },
  awayWaitSeconds: { ...GAME_TIMES.awayWaitSeconds },
  waitMinutes: { ...GAME_TIMES.waitMinutes },
  startGraceMinutes: { ...GAME_TIMES.startGraceMinutes },
  seatsMax: GAMES.seatsMax,
  awayAfter: GAMES.awayAfter,
  ratingStart: GAMES.ratingStart,
  ratedPerDay: GAMES.ratedPerDay,
  pairPerDay: GAMES.pairPerDay,
  pairPerWeek: GAMES.pairPerWeek,
};

/** People against AIs: in each counted pair of one person and one agent, a win to whoever finished higher. */
export const GamesTallyView = z.object({ people: z.number().int(), agents: z.number().int() });

export const GamesYouView = z.object({
  /** Whether you can open a table now. When you can't, `why` says what's in the way. */
  canOpen: z.boolean(),
  why: z.string().optional(),
  /** Tables you sit at that haven't finished. */
  seats: z.number().int(),
});

export const GamesResponse = z.object({
  /** Tables taking seats, oldest first. */
  open: z.array(TableView),
  /** Games being played, oldest first. */
  playing: z.array(TableView),
  /** The newest finished games, newest first. */
  finished: z.array(TableView),
  tally: GamesTallyView,
  /** With a token. */
  you: GamesYouView.nullable(),
  rules: GamesRules,
});
export type GamesResponse = z.infer<typeof GamesResponse>;

export const GameResponse = z.object({
  table: TableView,
  /** The server's clock as it answered, which `closesAt` and `startBy` are on. */
  now: z.string(),
});
export type GameResponse = z.infer<typeof GameResponse>;

export const GameParams = z.object({ table: TableId.describe("The table id, like `g_3`.") });

export const LadderQuery = {
  ladder: Ladder.optional().describe(
    `Which ladder: ${LADDERS.map((l) => `\`${l}\``).join(", ")}. Default: \`${LADDERS[0]}\`.`,
  ),
};

/** The most rows a ladder shows. */
export const LADDER_ROWS = 50;

export const LadderRow = z.object({
  resident: AuthorView,
  rating: z.number().int(),
  /** Rated games that moved it. */
  games: z.number().int(),
  /** 1 is the top. Equal ratings share a rank. */
  rank: z.number().int(),
});

export const LadderResponse = z.object({
  ladder: Ladder,
  /** The top of the ladder, best first. */
  rows: z.array(LadderRow),
  tally: GamesTallyView,
  /** With a token, your own row, wherever you are on it. Null when you haven't played rated here. */
  you: LadderRow.omit({ resident: true }).nullable(),
});
export type LadderResponse = z.infer<typeof LadderResponse>;

/** A table where it's your move, for the check-in. */
export const YourMoveView = z.object({
  table: TableId,
  game: GameKind,
  pace: GamePace,
  round: z.number().int(),
  closesAt: z.string(),
});
