/**
 * Party games in words (RFC 0011): names, paces, rounds, time left, and what a round gave each
 * seat. Pure, so tests pin them. The server decides everything; these only say what it sent.
 */
import {
  GAME_NAMES,
  GAME_TIMES,
  type Ladder,
  ordinal,
  type RoundView,
  type TableView,
} from "@terrakin/protocol";
import { GAME_RULES } from "@terrakin/sim";
import { formatCount, plural } from "@terrakin/ui/format";

/** "Hearth race", "Lowest lantern". */
export const gameName = (game: TableView["game"]) => GAME_NAMES[game];

/** What a pace means, in a few words. */
export const PACE_WORDS: Record<TableView["pace"], string> = {
  live: `Live: ${GAME_TIMES.roundSeconds.live} seconds a round`,
  slow: `Slow: ${GAME_TIMES.roundSeconds.slow / 3600} hours a round`,
};

/** "1, 2, or 3". */
const orList = (moves: readonly number[]) =>
  moves.length < 2 ? moves.join("") : `${moves.slice(0, -1).join(", ")}, or ${moves.at(-1)}`;

const race = GAME_RULES.hearth_race;
const lantern = GAME_RULES.lowest_lantern;

/** How each game goes, in a sentence for the page and the sheet, from the sim's own rules. */
export const GAME_ABOUT: Record<TableView["game"], string> = {
  hearth_race: `Each round, everyone picks ${orList(race.moves)} steps along a track of ${race.goal}. A pick nobody else made moves you; a pick two share moves neither. First home wins.`,
  lowest_lantern: `Each round, everyone picks a number from ${lantern.moves[0]} to ${lantern.moves.at(-1)}. The lowest number nobody else picked scores a point. ${lantern.roundsMax} rounds; most points wins.`,
};

/** The moves as the decide sheet labels them. */
export function moveLabel(game: TableView["game"], move: number): string {
  if (game === "hearth_race") return plural(move, "step", "steps");
  return String(move);
}

/** "Round 3", "Round 3 of 5": Hearth race ends when someone gets home, so it shows no total. */
export function roundWords(t: Pick<TableView, "game" | "round" | "roundsMax">): string {
  return t.game === "lowest_lantern" ? `Round ${t.round} of ${t.roundsMax}` : `Round ${t.round}`;
}

/** "32 seconds left", "about 3 hours left", "closing now". */
export function timeLeftWords(ms: number): string {
  if (ms <= 1_000) return "closing now";
  const seconds = Math.ceil(ms / 1_000);
  if (seconds < 60) return `${plural(seconds, "second", "seconds")} left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(minutes, "minute", "minutes")} left`;
  const hours = Math.round(minutes / 60);
  return `about ${plural(hours, "hour", "hours")} left`;
}

/** A seat's score: "7 of 12" on the track, or "2 points". */
export function scoreWords(game: TableView["game"], score: number): string {
  if (game === "hearth_race") return `${score} of ${GAME_RULES.hearth_race.goal}`;
  return plural(score, "point", "points");
}

/** What one seat did in a round: "picked 3, moved 3", "picked 2, stayed put", "didn't choose". */
export function pickWords(game: TableView["game"], round: RoundView, id: string): string {
  const move = round.moves[id];
  const gained = round.gained[id] ?? 0;
  if (move === null || move === undefined) return "didn't choose";
  if (game === "hearth_race") {
    return gained > 0 ? `picked ${move}, moved ${gained}` : `picked ${move}, stayed put`;
  }
  return gained > 0 ? `picked ${move}, scored a point` : `picked ${move}`;
}

/** Who won, or who shares first place, by name. Empty until it's over. */
export function winnerWords(t: Pick<TableView, "seats" | "status">): string {
  if (t.status !== "over") return "";
  const first = t.seats.filter((s) => s.place === 1).map((s) => s.resident.name);
  if (first.length === 0) return "";
  if (first.length === 1) return `${first[0]} won.`;
  return `${first.slice(0, -1).join(", ")} and ${first.at(-1)} share first place.`;
}

/** A ladder's tab: who plays on it, "People" or "Agents", over its pace, "live" or "slow". */
export function ladderTab(ladder: Ladder): [who: string, pace: string] {
  const [who, pace] = ladder.split(":");
  return [who === "people" ? "People" : "Agents", pace ?? ""];
}

/** "Slow games: 1,016, 2nd", a ladder on a profile. */
export function ratingWords(r: { ladder: Ladder; rating: number; rank: number }): string {
  const pace = r.ladder.endsWith(":live") ? "Live" : "Slow";
  return `${pace} games: ${formatCount(r.rating)}, ${ordinal(r.rank)}`;
}
