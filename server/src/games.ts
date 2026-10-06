import {
  type AuthorView,
  GAME_NAMES,
  GAME_TIMES,
  GAMES_RULES,
  type GameRatingView,
  type GamesResponse,
  LADDER_ROWS,
  type LadderResponse,
  type RoundView,
  type TableView,
} from "@terrakin/protocol";
import {
  activeTables,
  fnv1a,
  GAME_RULES,
  type GameKind,
  type GamePace,
  type GameTable,
  hasDecided,
  isAway,
  LADDERS,
  type Ladder,
  ladderRows,
  legalMoves,
  openTableProblem,
  own,
  residentById,
  roundBoards,
  roundSettled,
  seatOf,
  seatsHeld,
  sitProblem,
  starterOf,
  tableMoves,
  type WorldState,
} from "@terrakin/sim";
import { unknownAuthor } from "./town";

/**
 * Party games (RFC 0011) as the API shows them. The sim holds every table and decides every step;
 * this adds names, times on the server's clock, and the viewer's own moves. A choice in the round
 * being played reaches nobody but its own seat (`you.sealed`): everyone's comes out together when
 * the round closes.
 */

type Authors = (id: string) => AuthorView | undefined;

const iso = (ms: number) => new Date(ms).toISOString();

/** When a playing table's round closes at the latest, in ms on the server's clock. */
export const closesAt = (t: GameTable) =>
  (t.roundAt ?? t.openedAt) + GAME_TIMES.roundSeconds[t.pace] * 1000;

/**
 * Whether the server closes a playing round now: every seat has decided, its window has ended, or
 * every seat still to decide is away and the round has been open `GAME_TIMES.awayWaitSeconds`, so
 * an away seat always has a moment to come back, however fast the others choose.
 */
export function closeDue(t: GameTable, now: number): boolean {
  if (t.status !== "playing") return false;
  if (now >= closesAt(t) || t.seats.every((s) => hasDecided(t, s.resident))) return true;
  const opened = t.roundAt ?? t.openedAt;
  return roundSettled(t) && now >= opened + GAME_TIMES.awayWaitSeconds[t.pace] * 1000;
}

/** When an open table closes if nobody starts it, in ms. */
export const startBy = (t: GameTable) => t.openedAt + GAME_TIMES.waitMinutes[t.pace] * 60_000;

/**
 * Whether anyone seated may start an open table now: it has had enough seats for the start grace
 * and its first seat hasn't started it. The server says so in the `start_game` it logs.
 */
export const startFree = (t: GameTable, now: number) =>
  t.status === "open" &&
  t.readyAt !== undefined &&
  now >= t.readyAt + GAME_TIMES.startGraceMinutes[t.pace] * 60_000;

/** Every closed round as views carry it, with what each seat gained, oldest first. */
function roundViews(t: GameTable): RoundView[] {
  const boards = roundBoards(t);
  return t.rounds.map((moves, i) => {
    const before = boards[i - 1];
    const after = boards[i] ?? {};
    const gained: Record<string, number> = {};
    for (const s of t.seats) {
      gained[s.resident] = (after[s.resident] ?? 0) - (before?.[s.resident] ?? 0);
    }
    return { round: i + 1, moves: { ...moves }, gained };
  });
}

export function tableView(
  state: WorldState,
  t: GameTable,
  author: Authors,
  viewer: string | undefined,
  options: { now: number; history?: boolean },
): TableView {
  const playing = t.status === "playing";
  const over = t.status === "over";
  const kinds = new Map(t.seats.map((s) => [s.resident, s.kind]));
  /** Whether a seat is in a counted pair with a seat of its own kind (`same`) or of the other. */
  const counted = (id: string, same: boolean) =>
    t.status !== "open" &&
    (t.pairs ?? []).some(([a, b]) => {
      const other = a === id ? b : b === id ? a : null;
      return other !== null && (kinds.get(other) === kinds.get(id)) === same;
    });
  const seats = t.seats.map((s) => {
    const change = t.changes?.find((c) => c.resident === s.resident);
    return {
      resident: author(s.resident) ?? unknownAuthor(s.resident),
      kind: s.kind,
      rated: t.status === "open" ? null : counted(s.resident, true),
      tally: t.status === "open" ? null : counted(s.resident, false),
      away: isAway(s),
      decided: playing && hasDecided(t, s.resident),
      score: own(t.board, s.resident) ?? 0,
      place: own(t.places, s.resident) ?? null,
      rating: change
        ? { ladder: change.ladder, rating: change.rating, change: change.change }
        : null,
    };
  });
  const rounds = roundViews(t);
  let you: TableView["you"] = null;
  if (viewer && residentById(state, viewer)) {
    const seated = seatOf(t, viewer) !== undefined;
    const moves = over ? [] : tableMoves(state, viewer, t, { free: startFree(t, options.now) });
    const why = !seated && t.status === "open" ? sitProblem(state, viewer, t) : null;
    you = {
      seated,
      moves,
      legal: moves.includes("decide") ? [...legalMoves(t.game)] : [],
      // Only ever the viewer's own choice.
      sealed: playing ? (own(t.sealed, viewer) ?? null) : null,
      ...(why && !moves.includes("sit") ? { why: why.message } : {}),
    };
  }
  return {
    id: t.id,
    game: t.game,
    pace: t.pace,
    status: t.status,
    place: { x: t.place.x, y: t.place.y },
    seats,
    round: t.round,
    roundsMax: GAME_RULES[t.game].roundsMax,
    openedAt: iso(t.openedAt),
    closesAt: playing ? iso(closesAt(t)) : null,
    startBy: t.status === "open" ? iso(startBy(t)) : null,
    last: rounds.at(-1) ?? null,
    ...(options.history ? { history: rounds } : {}),
    // The salt guards the world's hash while choices are sealed; once it's over there are none.
    salt: over ? t.salt : null,
    you,
  };
}

/** `GET /v1/games`. */
export function gamesView(
  state: WorldState,
  viewer: string | undefined,
  author: Authors,
  now: number,
): GamesResponse {
  const tables = activeTables(state);
  const view = (t: GameTable) => tableView(state, t, author, viewer, { now });
  let you: GamesResponse["you"] = null;
  if (viewer && residentById(state, viewer)) {
    const problem = openTableProblem(state, viewer);
    you = {
      canOpen: problem === null,
      ...(problem ? { why: problem.message } : {}),
      seats: seatsHeld(state, viewer),
    };
  }
  return {
    open: tables.filter((t) => t.status === "open").map(view),
    playing: tables.filter((t) => t.status === "playing").map(view),
    finished: [...(state.games?.finished ?? [])].reverse().map(view),
    tally: { ...(state.games?.tally ?? { people: 0, agents: 0 }) },
    you,
    rules: GAMES_RULES,
  };
}

/** Each resident's rank on a ladder: 1 plus how many are rated higher. */
function ranked(state: WorldState, ladder: Ladder) {
  const rows = ladderRows(state, ladder);
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.rating > r.rating).length }));
}

/** `GET /v1/games/ladders`. */
export function ladderView(
  state: WorldState,
  ladder: Ladder,
  viewer: string | undefined,
  author: Authors,
): LadderResponse {
  const rows = ranked(state, ladder);
  const mine = viewer === undefined ? undefined : rows.find((r) => r.resident === viewer);
  return {
    ladder,
    rows: rows.slice(0, LADDER_ROWS).map((r) => ({
      resident: author(r.resident) ?? unknownAuthor(r.resident),
      rating: r.rating,
      games: r.games,
      rank: r.rank,
    })),
    tally: { ...(state.games?.tally ?? { people: 0, agents: 0 }) },
    you: mine ? { rating: mine.rating, games: mine.games, rank: mine.rank } : null,
  };
}

/** A resident's ladders for their profile: each one they've played rated on. */
export function gameRatings(state: WorldState, id: string): GameRatingView[] {
  return LADDERS.flatMap((ladder) => {
    const row = ranked(state, ladder).find((r) => r.resident === id);
    return row ? [{ ladder, rating: row.rating, games: row.games, rank: row.rank }] : [];
  });
}

/**
 * What a townsfolk seat plays (RFC 0011): one of its game's three lowest moves, picked by a hash of
 * the table's salt, the round, and the seat. Nobody can foresee it while the salt is secret, and
 * anyone can check it once the game is over and the salt is out. It's logged like any `decide`.
 */
export function townsfolkMove(t: GameTable, resident: string): number {
  const moves = legalMoves(t.game).slice(0, 3);
  const h = Number.parseInt(fnv1a(`${t.salt}:${t.round}:${resident}`), 16);
  return moves[h % moves.length] ?? 1;
}

/** "Hearth race", for todo lines and pages. */
export const gameName = (game: GameKind) => GAME_NAMES[game];

/** "about 3 hours", "about 40 minutes", "under a minute". */
export function timeLeft(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A viewer's games for the check-in: tables waiting on their choice, theirs to start, and ended. */
export function gamesCheckin(
  state: WorldState,
  viewer: string,
  sinceDay: number,
  now: number,
): {
  yourMove: { table: string; game: GameKind; pace: GamePace; round: number; closesAt: string }[];
  canStart: string[];
  ended: { table: string; game: GameKind; place: number; seats: number }[];
} | null {
  const mine = activeTables(state).filter((t) => seatOf(t, viewer));
  const yourMove = mine
    .filter((t) => t.status === "playing" && !hasDecided(t, viewer))
    .sort((a, b) => closesAt(a) - closesAt(b))
    .map((t) => ({
      table: t.id,
      game: t.game,
      pace: t.pace,
      round: t.round,
      closesAt: iso(closesAt(t)),
    }));
  const canStart = mine
    .filter(
      (t) =>
        t.status === "open" &&
        t.seats.length >= GAME_RULES[t.game].minSeats &&
        (starterOf(state, t) === viewer || startFree(t, now)),
    )
    .map((t) => t.id);
  const ended = [...(state.games?.finished ?? [])]
    .reverse()
    .filter((t) => (t.endedDay ?? 0) >= sinceDay && seatOf(t, viewer))
    .map((t) => ({
      table: t.id,
      game: t.game,
      place: own(t.places, viewer) ?? t.seats.length,
      seats: t.seats.length,
    }));
  if (mine.length === 0 && ended.length === 0) return null;
  return { yourMove, canStart, ended };
}
