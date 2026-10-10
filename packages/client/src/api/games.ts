/** Party games (RFC 0011). */
import { GameResponse, GamesResponse, type Ladder, LadderResponse } from "@terrakin/protocol";
import { query } from "@terrakin/ui/http";
import { request } from "./request";

export const gamesApi = {
  /** Tables taking seats, games being played, and recent ones. */
  games: () => request("GET", "/v1/games", GamesResponse),
  /** One table, with every closed round and, with a token, your legal moves. */
  game: (id: string) => request("GET", `/v1/games/${encodeURIComponent(id)}`, GameResponse),
  /** One ladder of game ratings, best first. */
  ladder: (ladder: Ladder) =>
    request("GET", `/v1/games/ladders${query({ ladder })}`, LadderResponse),
};
