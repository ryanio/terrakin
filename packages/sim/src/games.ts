import { isWhole, refuse } from "./check";
import { isTownsfolk, sameHousehold } from "./economy";
import { tileKey } from "./keys";
import { own, residentById } from "./own";
import { townEligibility } from "./town";
import type {
  Command,
  GameKind,
  GamePace,
  GameSeat,
  GamesState,
  GameTable,
  Ladder,
  RatingChange,
  Rejection,
  Resident,
  ResidentId,
  ResidentKind,
  Tile,
  WorldEvent,
  WorldState,
} from "./types";
import { GAME_KINDS, GAME_PACES } from "./types";
import { worldGround } from "./walk";
import { canBuildOn, chebyshev, commonsPlot, gameTableTiles, inBounds } from "./world";

/**
 * Party games (RFC 0011): short games at tables in the Commons, where the server plays the seat
 * and players only decide.
 *
 * Every round is sealed and simultaneous. A round opens, each seat sends one `decide`, and the
 * server logs `close_round` once everyone has decided or the window has run out. Choices sit in
 * `sealed` until then, where no view or event shows them, and come out together in `round_closed`.
 * The first and the last choice in a window count the same. A seat that doesn't decide plays the
 * game's default; after `GAMES.awayAfter` rounds in a row it's away until it decides again.
 *
 * Time comes in as logged inputs: the server stamps `open_table` and `start_game` with its clock
 * and decides when each round closes, so the window length is the server's word and replay never
 * reads a clock. The table's secret, the salt the server logged with it, keeps sealed choices from
 * being guessed against the world's hash. Nothing here runs until the first `open_table`, so older logs replay
 * exactly.
 *
 * Ratings live here too: whole-number Elo per ladder (people or agents, at each pace), from each
 * finished game's places, counted pair by pair.
 */

/**
 * The numbers. Replay checks logged games against them, so a change that would replay an old game
 * differently needs a logged switch, the way `set_shop_share` does for the shop.
 */
export const GAMES = {
  /** Tables one resident may sit at that haven't finished, their own included. */
  seatsMax: 3,
  /** Rounds missed in a row before a seat is away. */
  awayAfter: 2,
  /** Finished games kept in the world, newest last. Older ones drop off. */
  keepFinished: 20,
  /** Where every rating starts. */
  ratingStart: 1_000,
  /** How far one game can move a rating: a win against an equal moves it by half of this. */
  k: 32,
  /** Rated games one resident may start a day. Past it they play unrated. */
  ratedPerDay: 20,
  /** Counted games one pair may start a day. Past it the pair plays unrated. */
  pairPerDay: 3,
  /**
   * Counted games one pair may start in a UTC week, Monday to Sunday. Past it the pair plays
   * unrated. One pair that always plays out the same result stops moving ratings at about 1,365
   * against 635, where a rounded change falls to 0; with only the daily cap it got there in about
   * 90 days, and with this cap it takes about 180.
   */
  pairPerWeek: 7,
} as const;

/** What one game is. */
export interface GameRules {
  /** Seats it needs to start, and the most it takes. */
  minSeats: number;
  maxSeats: number;
  /** What a seat may choose in a round. */
  moves: readonly number[];
  /** It ends after this round, however the board stands. */
  roundsMax: number;
  /** Hearth race: the space that wins. */
  goal?: number;
}

/**
 * The games. A seat that doesn't decide plays nothing: no steps in Hearth race, no pick in Lowest
 * lantern.
 */
export const GAME_RULES: Record<GameKind, GameRules> = {
  hearth_race: { minSeats: 2, maxSeats: 6, moves: [1, 2, 3], roundsMax: 30, goal: 12 },
  lowest_lantern: {
    minSeats: 3,
    maxSeats: 8,
    moves: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    roundsMax: 5,
  },
};

/** A table's salt: 128 bits from the server, as 32 lowercase hex characters. */
export const SALT_PATTERN = /^[0-9a-f]{32}$/;

/** A table's id: `g_` and a number. */
export const TABLE_ID_PATTERN = /^g_[1-9][0-9]*$/;

export const isGameKind = (v: unknown): v is GameKind =>
  typeof v === "string" && (GAME_KINDS as readonly string[]).includes(v);
export const isGamePace = (v: unknown): v is GamePace =>
  typeof v === "string" && (GAME_PACES as readonly string[]).includes(v);

type Mutation = () => WorldEvent[];
export type GamesChecked = Mutation | Rejection;

// ---------- where tables stand ----------

/** The first spot with no table and no block on it, or undefined when every one is taken. */
function freeSpot(state: WorldState): Tile | undefined {
  const taken = new Set(
    Object.values(state.games?.tables ?? {}).map((t) => tileKey(t.place.x, t.place.y)),
  );
  return gameTableTiles(state.config).find(
    (t) => !taken.has(tileKey(t.x, t.y)) && state.blocks[tileKey(t.x, t.y)] === undefined,
  );
}

/**
 * Where sitting puts a resident: nowhere new when they already stand beside the table, else the
 * open tile in the Commons nearest it (by Chebyshev distance, then north to south, then west to
 * east), never a table's spot, a block, a building, or where someone else stands. Undefined means
 * they stay put, which is also the answer when no tile is open.
 */
function besideTable(state: WorldState, me: Resident, place: Tile): Tile | undefined {
  const { config } = state;
  const ground = worldGround(state);
  const spots = new Set(gameTableTiles(config).map((t) => tileKey(t.x, t.y)));
  const open = (x: number, y: number) =>
    ground.obstacle(x, y) === undefined && !spots.has(tileKey(x, y));
  if (chebyshev(me, place) === 1 && open(me.x, me.y)) return undefined;
  const others = new Set(
    Object.values(state.residents)
      .filter((r) => r.online && r.id !== me.id)
      .map((r) => tileKey(r.x, r.y)),
  );
  const { plotSize } = config;
  const c = commonsPlot(config);
  const tiles: Tile[] = [];
  for (let y = c.py * plotSize; y < (c.py + 1) * plotSize; y++) {
    for (let x = c.px * plotSize; x < (c.px + 1) * plotSize; x++) {
      if (inBounds(config, x, y) && open(x, y) && !others.has(tileKey(x, y))) tiles.push({ x, y });
    }
  }
  tiles.sort((a, b) => chebyshev(a, place) - chebyshev(b, place) || a.y - b.y || a.x - b.x);
  const to = tiles[0];
  return to && (to.x !== me.x || to.y !== me.y) ? to : undefined;
}

// ---------- reading tables ----------

/** A table that's open or playing, by id. */
export const activeTable = (state: WorldState, id: unknown): GameTable | undefined =>
  own(state.games?.tables, id);

/** Any table the world still has, open, playing, or among the newest finished. */
export const tableById = (state: WorldState, id: unknown): GameTable | undefined =>
  activeTable(state, id) ??
  (typeof id === "string" ? state.games?.finished.find((t) => t.id === id) : undefined);

/** Tables that are open or playing, oldest first. */
export function activeTables(state: WorldState): GameTable[] {
  return Object.values(state.games?.tables ?? {}).sort(byOpening);
}

const byOpening = (a: GameTable, b: GameTable) => Number(a.id.slice(2)) - Number(b.id.slice(2));

export const seatOf = (t: GameTable, id: string): GameSeat | undefined =>
  t.seats.find((s) => s.resident === id);

/** A seat that has missed `GAMES.awayAfter` rounds in a row. It plays the default until it decides. */
export const isAway = (s: GameSeat) => s.missed >= GAMES.awayAfter;

/** Whether a seat has chosen in the round being played. */
export const hasDecided = (t: GameTable, id: string) => own(t.sealed, id) !== undefined;

/**
 * Whether a playing round can close before its window ends: every seat has decided or is away.
 * The server closes it then, so a game never waits on a seat that keeps missing.
 */
export const roundSettled = (t: GameTable) =>
  t.status === "playing" && t.seats.every((s) => hasDecided(t, s.resident) || isAway(s));

/** What a seat may choose in a round of `game`. */
export const legalMoves = (game: GameKind): readonly number[] => GAME_RULES[game].moves;

/** Tables that haven't finished where `id` has a seat. */
export const seatsHeld = (state: WorldState, id: string) =>
  activeTables(state).filter((t) => seatOf(t, id) !== undefined).length;

/** Who starts a table: its first seat that isn't townsfolk. */
export const starterOf = (state: WorldState, t: GameTable): ResidentId | undefined =>
  t.seats.find((s) => !isTownsfolk(state, s.resident))?.resident;

/** The open table `id` would start, waiting to, if any. */
export const waitingTable = (state: WorldState, id: string) =>
  activeTables(state).find((t) => t.status === "open" && starterOf(state, t) === id);

/** The ladder a seat of `kind` plays on at `pace`. */
export const ladderOf = (kind: ResidentKind, pace: GamePace): Ladder =>
  `${kind === "human" ? "people" : "agents"}:${pace}`;

/** A resident's rating on a ladder, or where everyone starts. */
export const ratingOf = (state: WorldState, ladder: Ladder, id: string): number =>
  own(state.games?.ratings?.[ladder], id)?.rating ?? GAMES.ratingStart;

/** Everyone on a ladder with their rating and rated games, best first (then fewest games, then id). */
export function ladderRows(
  state: WorldState,
  ladder: Ladder,
): { resident: ResidentId; rating: number; games: number }[] {
  return Object.entries(state.games?.ratings?.[ladder] ?? {})
    .map(([resident, e]) => ({ resident, rating: e.rating, games: e.games }))
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        a.games - b.games ||
        (a.resident < b.resident ? -1 : a.resident > b.resident ? 1 : 0),
    );
}

// ---------- who counts ----------

/**
 * Whether two residents are one household for games: one household as the economy counts it
 * (owner-linked, or two AIs of one person), or sharing a plot. Seats from one household play each
 * other, and everyone else at the table, unrated.
 */
export function oneHousehold(state: WorldState, a: string, b: string): boolean {
  if (sameHousehold(state, a, b)) return true;
  return Object.values(state.plots).some((p) => canBuildOn(p, a) && canBuildOn(p, b));
}

const pairKey = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`);
const sortedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** The first day of the UTC week, Monday to Sunday, that world day `day` falls in. Day 0 was a Thursday. */
const weekStart = (day: number) => day - ((day + 3) % 7);

/**
 * Which seats a game starting now is rated for, and which pairs of them count. A seat is rated
 * when its resident may vote in the Town Hall (a plot held 3 days, a hearth, active lately, not
 * townsfolk), hasn't started `GAMES.ratedPerDay` rated games today, and shares no household with
 * another seat. A pair counts while it has started fewer than `GAMES.pairPerDay` counted games
 * today and `GAMES.pairPerWeek` this week. A seat with no counted pair isn't rated after all.
 */
function ratedAtStart(
  state: WorldState,
  t: GameTable,
): { rated: ResidentId[]; pairs: [ResidentId, ResidentId][] } {
  const today = state.games?.today;
  const week = state.games?.week;
  const thisWeek = week && week.start === weekStart(state.day ?? 0) ? week.pairs : undefined;
  const ids = t.seats.map((s) => s.resident);
  const candidates = ids.filter(
    (id) =>
      townEligibility(state, id).eligible &&
      (own(today?.rated, id) ?? 0) < GAMES.ratedPerDay &&
      !ids.some((o) => o !== id && oneHousehold(state, id, o)),
  );
  const pairs: [ResidentId, ResidentId][] = [];
  candidates.forEach((a, i) => {
    for (const b of candidates.slice(i + 1)) {
      const key = pairKey(a, b);
      if (
        (own(today?.pairs, key) ?? 0) < GAMES.pairPerDay &&
        (own(thisWeek, key) ?? 0) < GAMES.pairPerWeek
      ) {
        pairs.push(sortedPair(a, b));
      }
    }
  });
  const rated = candidates.filter((id) => pairs.some((p) => p.includes(id)));
  return { rated, pairs };
}

// ---------- ratings ----------

/**
 * The expected score of a player rated 0, 10, 20, ... 800 points above their opponent, in
 * thousandths: `1000 / (1 + 10^(-d / 400))`, rounded. A table of whole numbers, so every engine
 * rates the same game the same way.
 */
const EXPECTED = [
  500, 514, 529, 543, 557, 571, 585, 599, 613, 627, 640, 653, 666, 679, 691, 703, 715, 727, 738,
  749, 760, 770, 780, 790, 799, 808, 817, 826, 834, 841, 849, 856, 863, 870, 876, 882, 888, 894,
  899, 904, 909, 914, 918, 922, 926, 930, 934, 937, 941, 944, 947, 950, 952, 955, 957, 960, 962,
  964, 966, 968, 969, 971, 973, 974, 975, 977, 978, 979, 980, 982, 983, 983, 984, 985, 986, 987,
  988, 988, 989, 990, 990,
] as const;

/** The expected score, in thousandths, of a player rated `d` points above their opponent. */
export function expectedScore(d: number): number {
  const e = EXPECTED[Math.min(EXPECTED.length - 1, Math.floor(Math.abs(d) / 10))] ?? 990;
  return d >= 0 ? e : 1000 - e;
}

/**
 * What a finished game moves: each rated seat's rating on its ladder, from every counted pair on
 * that ladder (1 for finishing higher, a half for the same place, 0 for lower, against what their
 * ratings expected), scaled so a whole table moves a rating about as much as one game against one
 * player; and the people-against-AIs tally, a win to the side that finished higher in each counted
 * pair of one person and one agent.
 */
function rate(
  state: WorldState,
  t: GameTable,
  places: Record<string, number>,
): { changes: RatingChange[]; tally: { people: number; agents: number } } {
  const counted = new Set((t.pairs ?? []).map(([a, b]) => pairKey(a, b)));
  const changes: RatingChange[] = [];
  for (const kind of ["human", "agent"] as const) {
    const ladder = ladderOf(kind, t.pace);
    const group = t.seats.filter((s) => s.rated && s.kind === kind).map((s) => s.resident);
    if (group.length < 2) continue;
    const before = new Map(group.map((id) => [id, ratingOf(state, ladder, id)]));
    for (const id of group) {
      let sum = 0;
      let pairs = 0;
      for (const other of group) {
        if (other === id || !counted.has(pairKey(id, other))) continue;
        const mine = places[id] ?? 0;
        const theirs = places[other] ?? 0;
        const score = mine < theirs ? 1000 : mine === theirs ? 500 : 0;
        sum += score - expectedScore((before.get(id) ?? 0) - (before.get(other) ?? 0));
        pairs++;
      }
      if (pairs === 0) continue;
      // `|| 0` keeps a rounded -0 out of the world.
      const change = Math.round((GAMES.k * sum) / (1000 * (group.length - 1))) || 0;
      changes.push({ resident: id, ladder, rating: (before.get(id) ?? 0) + change, change });
    }
  }
  const tally = { people: 0, agents: 0 };
  for (const [a, b] of t.pairs ?? []) {
    const sa = seatOf(t, a);
    const sb = seatOf(t, b);
    if (!sa || !sb || sa.kind === sb.kind) continue;
    const pa = places[a] ?? 0;
    const pb = places[b] ?? 0;
    if (pa === pb) continue;
    const winner = pa < pb ? sa : sb;
    if (winner.kind === "human") tally.people++;
    else tally.agents++;
  }
  return { changes, tally };
}

// ---------- rounds ----------

/** One closed round, worked out before anything changes. */
interface RoundOutcome {
  moves: Record<ResidentId, number | null>;
  board: Record<ResidentId, number>;
  /** Each seat's missed rounds after this one, in seat order. */
  missed: number[];
  away: ResidentId[];
  /** Set when the game ends with this round. */
  end?: {
    places: Record<ResidentId, number>;
    changes: RatingChange[];
    tally: { people: number; agents: number };
  };
}

/**
 * Hearth race: every seat whose pick nobody else made moves that many spaces; a pick two seats
 * share moves neither. Returns the seats that reached the goal, the winner first: the higher pick
 * wins a tie, then the earlier seat.
 */
function raceStep(
  t: GameTable,
  goal: number,
  moves: Record<ResidentId, number | null>,
  board: Record<ResidentId, number>,
): ResidentId[] {
  const counts = new Map<number, number>();
  for (const s of t.seats) {
    const m = moves[s.resident];
    if (m !== null && m !== undefined) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const home: { id: ResidentId; pick: number; seat: number }[] = [];
  t.seats.forEach((s, seat) => {
    const pick = moves[s.resident];
    if (pick === null || pick === undefined || counts.get(pick) !== 1) return;
    const at = Math.min(goal, (board[s.resident] ?? 0) + pick);
    board[s.resident] = at;
    if (at >= goal) home.push({ id: s.resident, pick, seat });
  });
  home.sort((a, b) => b.pick - a.pick || a.seat - b.seat);
  return home.map((h) => h.id);
}

/** Lowest lantern: the seat with the lowest pick nobody else made scores a point. */
function lanternStep(
  t: GameTable,
  moves: Record<ResidentId, number | null>,
  board: Record<ResidentId, number>,
) {
  const counts = new Map<number, number>();
  for (const s of t.seats) {
    const m = moves[s.resident];
    if (m !== null && m !== undefined) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  let lowest: number | undefined;
  for (const [m, n] of counts) if (n === 1 && (lowest === undefined || m < lowest)) lowest = m;
  const winner = t.seats.find((s) => moves[s.resident] === lowest);
  if (lowest !== undefined && winner) board[winner.resident] = (board[winner.resident] ?? 0) + 1;
}

/**
 * Places at the end: seats that reached the hearth first, in the order they won it, then everyone
 * else by board, higher first. Equal boards share a place, and the next place skips (1, 2, 2, 4).
 */
function placesOf(
  t: GameTable,
  board: Record<ResidentId, number>,
  home: readonly ResidentId[],
): Record<ResidentId, number> {
  const rest = t.seats.map((s) => s.resident).filter((id) => !home.includes(id));
  const places: Record<ResidentId, number> = {};
  for (const s of t.seats) {
    const id = s.resident;
    const first = home.indexOf(id);
    places[id] =
      first >= 0
        ? first + 1
        : home.length + 1 + rest.filter((o) => (board[o] ?? 0) > (board[id] ?? 0)).length;
  }
  return places;
}

/**
 * The board after each closed round, worked out again from the choices with the game's own rule,
 * so a view can say what each round gave each seat without a rule of its own. Reads only.
 */
export function roundBoards(t: GameTable): Record<ResidentId, number>[] {
  const board: Record<ResidentId, number> = {};
  for (const s of t.seats) board[s.resident] = 0;
  return t.rounds.map((moves) => {
    switch (t.game) {
      case "hearth_race":
        raceStep(t, GAME_RULES.hearth_race.goal ?? 0, moves, board);
        break;
      case "lowest_lantern":
        lanternStep(t, moves, board);
        break;
    }
    return { ...board };
  });
}

/** How a round closes, worked out against the table as it stands, changing nothing. */
function outcome(state: WorldState, t: GameTable): RoundOutcome {
  const rules = GAME_RULES[t.game];
  const moves: Record<ResidentId, number | null> = {};
  const board: Record<ResidentId, number> = {};
  for (const s of t.seats) {
    moves[s.resident] = own(t.sealed, s.resident) ?? null;
    board[s.resident] = own(t.board, s.resident) ?? 0;
  }
  let home: ResidentId[] = [];
  switch (t.game) {
    case "hearth_race":
      home = raceStep(t, rules.goal ?? 0, moves, board);
      break;
    case "lowest_lantern":
      lanternStep(t, moves, board);
      break;
  }
  const missed = t.seats.map((s) => (moves[s.resident] === null ? s.missed + 1 : 0));
  const away = t.seats.filter((_, i) => (missed[i] ?? 0) >= GAMES.awayAfter).map((s) => s.resident);
  const over = home.length > 0 || t.round >= rules.roundsMax || away.length === t.seats.length;
  if (!over) return { moves, board, missed, away };
  const places = placesOf(t, board, home);
  return { moves, board, missed, away, end: { places, ...rate(state, t, places) } };
}

// ---------- resident commands ----------

function ensureGames(state: WorldState): GamesState {
  state.games ??= { nextId: 1, tables: {}, finished: [], today: { rated: {}, pairs: {} } };
  return state.games;
}

const timeProblem = (at: unknown) =>
  isWhole(at) && at >= 0
    ? null
    : refuse("invalid_game", "The server stamps tables with its clock.");

/** An open or playing table with the games it's part of, or why not. */
function tableFor(state: WorldState, id: unknown): { games: GamesState; t: GameTable } | Rejection {
  const games = state.games;
  const t = activeTable(state, id);
  if (games && t) return { games, t };
  if (tableById(state, id)) return refuse("table_not_open", "That game is over.");
  return refuse("unknown_table", "No open or playing table has that id. See GET /v1/games.");
}

/**
 * `open_table {game, pace, salt, at}`: open a table at the first free spot in the Commons and take
 * its first seat. The server fills in the salt and the time. Only from a resident with a hearth,
 * one waiting table each, and seats at no more than `GAMES.seatsMax` tables at once.
 */
export function checkOpenTable(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "open_table" }>,
): GamesChecked {
  const me = residentById(state, actor);
  const day = state.day;
  if (!me || day === undefined) return refuse("not_due", "Games open once the world counts days.");
  const { game, pace, salt, at } = command;
  if (!isGameKind(game)) {
    return refuse("invalid_game", `Games are ${GAME_KINDS.join(" and ")}.`);
  }
  if (!isGamePace(pace)) return refuse("invalid_game", "A table's pace is live or slow.");
  if (typeof salt !== "string" || !SALT_PATTERN.test(salt)) {
    return refuse("invalid_game", "The server gives every table its salt.");
  }
  const late = timeProblem(at);
  if (late) return late;
  if (!me.hearth) {
    return refuse(
      "no_hearth",
      "Tables are opened from home, so set a hearth first. build_starter_home sets one for you. You can sit at anyone's table without one.",
    );
  }
  const waiting = waitingTable(state, actor);
  if (waiting) {
    return refuse(
      "table_limit",
      `Your table ${waiting.id} is still waiting. Start it with start_game, or stand up first.`,
    );
  }
  if (seatsHeld(state, actor) >= GAMES.seatsMax) {
    return refuse("table_limit", `You can sit at ${GAMES.seatsMax} tables at once.`);
  }
  const spot = freeSpot(state);
  if (!spot) {
    return refuse(
      "table_limit",
      "Every table in the Commons is in use. Sit at one of them (GET /v1/games), or try again when a game ends.",
    );
  }
  const to = besideTable(state, me, spot);
  return () => {
    const games = ensureGames(state);
    const id = `g_${games.nextId}`;
    games.nextId += 1;
    games.tables[id] = {
      id,
      game,
      pace,
      place: { ...spot },
      seats: [{ resident: actor, kind: me.kind, missed: 0 }],
      status: "open",
      openedDay: day,
      openedAt: at,
      round: 0,
      sealed: {},
      secret: salt,
      board: {},
      rounds: [],
    };
    const events: WorldEvent[] = [
      { type: "table_opened", table: id, game, pace, x: spot.x, y: spot.y, by: actor, at },
      { type: "seated", table: id, resident: actor, kind: me.kind },
    ];
    if (to) {
      me.x = to.x;
      me.y = to.y;
      events.push({ type: "moved", residentId: actor, x: to.x, y: to.y });
    }
    return events;
  };
}

/**
 * `sit {table, at}`: take a seat at an open table, from anywhere. It puts you beside the table. The
 * server stamps `at`; the seat that gives the table enough players to start sets its `readyAt`.
 */
export function checkSit(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "sit" }>,
): GamesChecked {
  const me = residentById(state, actor);
  const found = tableFor(state, command.table);
  if ("code" in found) return found;
  const { t } = found;
  if (!me) return refuse("not_joined", "Join the world first.");
  if (t.status !== "open") {
    return refuse("table_not_open", "That game has started. Sit at an open table, or open one.");
  }
  if (seatOf(t, actor)) return refuse("already_seated", "You already have a seat there.");
  const rules = GAME_RULES[t.game];
  if (t.seats.length >= rules.maxSeats) {
    return refuse("table_full", `That table has all ${rules.maxSeats} seats taken.`);
  }
  if (seatsHeld(state, actor) >= GAMES.seatsMax) {
    return refuse("table_limit", `You can sit at ${GAMES.seatsMax} tables at once.`);
  }
  const late = timeProblem(command.at);
  if (late) return late;
  const ready = t.seats.length + 1 >= rules.minSeats && t.readyAt === undefined;
  const to = besideTable(state, me, t.place);
  return () => {
    t.seats.push({ resident: actor, kind: me.kind, missed: 0 });
    if (ready) t.readyAt = command.at;
    const events: WorldEvent[] = [{ type: "seated", table: t.id, resident: actor, kind: me.kind }];
    if (to) {
      me.x = to.x;
      me.y = to.y;
      events.push({ type: "moved", residentId: actor, x: to.x, y: to.y });
    }
    return events;
  };
}

/**
 * `stand {table}`: give up a seat before the game starts. A table with nobody left but townsfolk
 * closes, so townsfolk never hold a spot on their own.
 */
export function checkStand(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "stand" }>,
): GamesChecked {
  const found = tableFor(state, command.table);
  if ("code" in found) return found;
  const { games, t } = found;
  if (!seatOf(t, actor)) return refuse("not_seated", "You don't have a seat there.");
  if (t.status !== "open") {
    return refuse(
      "table_not_open",
      "The game has started. Your seat plays out: a round you miss plays the default.",
    );
  }
  const rest = t.seats.filter((s) => s.resident !== actor);
  const closes = !rest.some((s) => !isTownsfolk(state, s.resident));
  const short = rest.length < GAME_RULES[t.game].minSeats;
  return () => {
    t.seats = rest;
    const events: WorldEvent[] = [{ type: "stood", table: t.id, resident: actor }];
    if (closes) {
      delete games.tables[t.id];
      events.push({ type: "table_closed", table: t.id });
    } else if (short) {
      delete t.readyAt;
    }
    return events;
  };
}

/**
 * `start_game {table, at, free?}`: the first seat that isn't townsfolk starts the game once enough
 * have sat, and round 1 opens. `free`, which only the server sets, lets any other seat start it,
 * once the first has let the start grace pass.
 */
export function checkStartGame(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "start_game" }>,
): GamesChecked {
  const found = tableFor(state, command.table);
  if ("code" in found) return found;
  const { games, t } = found;
  if (t.status !== "open") return refuse("table_not_open", "That game has already started.");
  if (!seatOf(t, actor)) return refuse("not_seated", "You don't have a seat there.");
  if (command.free !== undefined && command.free !== true) {
    return refuse("invalid_game", "Only the server lets anyone seated start a table.");
  }
  const starter = starterOf(state, t);
  if (isTownsfolk(state, actor) || (actor !== starter && command.free !== true)) {
    return refuse(
      "not_your_table",
      `The first seat starts the game, and that's ${starter}. A few minutes after enough have sat, anyone seated can.`,
    );
  }
  const rules = GAME_RULES[t.game];
  if (t.seats.length < rules.minSeats) {
    return refuse(
      "not_enough_players",
      `It needs ${rules.minSeats} players, and ${t.seats.length} ${t.seats.length === 1 ? "has" : "have"} sat.`,
    );
  }
  const late = timeProblem(command.at);
  if (late) return late;
  const { rated, pairs } = ratedAtStart(state, t);
  const at = command.at;
  const monday = weekStart(state.day ?? 0);
  return () => {
    t.status = "playing";
    t.round = 1;
    t.roundAt = at;
    delete t.readyAt;
    t.sealed = {};
    t.board = Object.fromEntries(t.seats.map((s) => [s.resident, 0]));
    t.pairs = pairs;
    for (const s of t.seats) if (rated.includes(s.resident)) s.rated = true;
    for (const id of rated) games.today.rated[id] = (own(games.today.rated, id) ?? 0) + 1;
    if (pairs.length > 0 && games.week?.start !== monday) games.week = { start: monday, pairs: {} };
    for (const [a, b] of pairs) {
      const key = pairKey(a, b);
      games.today.pairs[key] = (own(games.today.pairs, key) ?? 0) + 1;
      if (games.week) games.week.pairs[key] = (own(games.week.pairs, key) ?? 0) + 1;
    }
    return [{ type: "game_started", table: t.id, rated: [...rated], at }];
  };
}

/**
 * `decide {table, round, move}`: your one choice this round, sealed until it closes. Only for the
 * round being played, once, and only a legal move.
 */
export function checkDecide(
  state: WorldState,
  actor: string,
  command: Extract<Command, { type: "decide" }>,
): GamesChecked {
  const t = activeTable(state, command.table);
  if (!t) {
    return tableById(state, command.table)
      ? refuse("wrong_round", "That game is over.")
      : refuse("unknown_table", "No open or playing table has that id. See GET /v1/games.");
  }
  if (!seatOf(t, actor)) return refuse("not_seated", "You don't have a seat there.");
  if (t.status !== "playing") {
    return refuse("wrong_round", "That game hasn't started yet. Its first seat starts it.");
  }
  if (command.round !== t.round) {
    return refuse("wrong_round", `It's round ${t.round} now. Decide for that one.`);
  }
  if (hasDecided(t, actor)) {
    return refuse("already_decided", "You've decided this round. It shows once the round closes.");
  }
  const legal = legalMoves(t.game);
  const { move } = command;
  if (!isWhole(move) || !legal.includes(move)) {
    return refuse(
      "illegal_move",
      t.game === "hearth_race"
        ? "In Hearth race you move 1, 2, or 3 spaces."
        : `In Lowest lantern you pick a number from 1 to ${legal.length}.`,
    );
  }
  return () => {
    t.sealed[actor] = move;
    return [{ type: "decided", table: t.id, round: t.round, resident: actor }];
  };
}

// ---------- server inputs ----------

/**
 * `close_round {table, round, at}`, which only TOWN_ACTOR sends: the round being played closes.
 * Every seat's choice comes out, seats that didn't decide play the default, and the board moves.
 * The game ends when someone reaches the hearth, after its last round, or when every seat is away;
 * otherwise the next round opens at `at`.
 */
export function checkCloseRound(
  state: WorldState,
  command: Extract<Command, { type: "close_round" }>,
): GamesChecked {
  const found = tableFor(state, command.table);
  if ("code" in found) return found;
  const { games, t } = found;
  if (t.status !== "playing" || command.round !== t.round) {
    return refuse(
      "wrong_round",
      `Only the round being played closes, and that's round ${t.round}.`,
    );
  }
  const late = timeProblem(command.at);
  if (late) return late;
  const result = outcome(state, t);
  const { at } = command;
  return () => {
    t.rounds.push({ ...result.moves });
    t.board = { ...result.board };
    t.seats.forEach((s, i) => {
      s.missed = result.missed[i] ?? 0;
    });
    t.sealed = {};
    const closed: WorldEvent = {
      type: "round_closed",
      table: t.id,
      round: t.round,
      moves: { ...result.moves },
      board: { ...result.board },
      away: [...result.away],
    };
    const end = result.end;
    if (!end) {
      t.round += 1;
      t.roundAt = at;
      return [{ ...closed, next: { round: t.round, at } }];
    }
    for (const c of end.changes) {
      games.ratings ??= {};
      const ladder = games.ratings[c.ladder] ?? {};
      ladder[c.resident] = { rating: c.rating, games: (own(ladder, c.resident)?.games ?? 0) + 1 };
      games.ratings[c.ladder] = ladder;
    }
    const added = end.tally.people + end.tally.agents > 0;
    if (added) {
      const was = games.tally ?? { people: 0, agents: 0 };
      games.tally = {
        people: was.people + end.tally.people,
        agents: was.agents + end.tally.agents,
      };
    }
    t.status = "over";
    t.places = { ...end.places };
    t.changes = end.changes.map((c) => ({ ...c }));
    t.endedAt = at;
    delete t.roundAt;
    delete games.tables[t.id];
    games.finished.push(t);
    if (games.finished.length > GAMES.keepFinished) games.finished.shift();
    return [
      closed,
      {
        type: "game_over",
        table: t.id,
        places: { ...end.places },
        salt: t.secret,
        ratings: end.changes.map((c) => ({ ...c })),
        ...(added && games.tally ? { tally: { ...games.tally } } : {}),
      },
    ];
  };
}

/** `close_table {table}`, which only TOWN_ACTOR sends: a table that never started closes. */
export function checkCloseTable(
  state: WorldState,
  command: Extract<Command, { type: "close_table" }>,
): GamesChecked {
  const found = tableFor(state, command.table);
  if ("code" in found) return found;
  const { games, t } = found;
  if (t.status !== "open") return refuse("table_not_open", "That game has started.");
  return () => {
    delete games.tables[t.id];
    return [{ type: "table_closed", table: t.id }];
  };
}

/** At `new_day`: today's counts for the caps on rated play start again. A no-op before games. */
export function gamesNewDay(state: WorldState): Mutation | null {
  const games = state.games;
  if (!games) return null;
  return () => {
    games.today = { rated: {}, pairs: {} };
    return [];
  };
}

/** What a resident can send about a table, as action types. */
export const TABLE_MOVES = ["sit", "stand", "start_game", "decide"] as const;
export type TableMove = (typeof TABLE_MOVES)[number];

/**
 * What `viewer` can send about a table now, from the commands' own checks, so views offer only
 * what the world would accept. `free` is the server's word that anyone seated may start it. Reads
 * only. Like a real command, it treats an offline resident as back, since acting brings them back.
 */
export function tableMoves(
  state: WorldState,
  viewer: string,
  t: GameTable,
  options: { free?: boolean } = {},
): TableMove[] {
  if (!residentById(state, viewer)) return [];
  const can = (checked: GamesChecked) => typeof checked === "function";
  const table = t.id;
  const moves: TableMove[] = [];
  if (can(checkSit(state, viewer, { type: "sit", table, at: 0 }))) moves.push("sit");
  if (can(checkStand(state, viewer, { type: "stand", table }))) moves.push("stand");
  const free = options.free ? { free: true as const } : {};
  if (can(checkStartGame(state, viewer, { type: "start_game", table, at: 0, ...free }))) {
    moves.push("start_game");
  }
  const move = legalMoves(t.game)[0] ?? 1;
  if (can(checkDecide(state, viewer, { type: "decide", table, round: t.round, move }))) {
    moves.push("decide");
  }
  return moves;
}

/** Why `viewer` can't sit at a table, or null. For views. */
export function sitProblem(state: WorldState, viewer: string, t: GameTable): Rejection | null {
  const checked = checkSit(state, viewer, { type: "sit", table: t.id, at: 0 });
  return typeof checked === "function" ? null : checked;
}

/**
 * Why `actor` can't open a table now, or null: the checks `open_table` runs, short of the server's
 * salt and time. For views.
 */
export function openTableProblem(state: WorldState, actor: string): Rejection | null {
  const checked = checkOpenTable(state, actor, {
    type: "open_table",
    game: "hearth_race",
    pace: "slow",
    salt: "0".repeat(32),
    at: 0,
  });
  return typeof checked === "function" ? null : checked;
}
