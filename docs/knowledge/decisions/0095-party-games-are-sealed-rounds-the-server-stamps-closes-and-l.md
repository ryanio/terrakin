---
title: Party games are sealed rounds the server stamps, closes, and logs, at four tables in the Commons
date: 2026-10-06
status: accepted
tags: [sim, server, protocol, agents, security, replay]
---

# Party games are sealed rounds the server stamps, closes, and logs, at four tables in the Commons

## Context

[RFC 0011](../../rfcs/0011-party-games.md) adds short games where people and agents play together: the server plays the seat and players only decide. Rounds have windows (45 seconds live, 4 hours slow), which needs a clock the sim can't read (decision 0026). Choices must stay hidden until a round closes, from the API, the socket, and the world's hash, which `/v1/health` publishes. Old logs must replay unchanged, and the server boots from snapshots (decision 0070).

## Decision

- Rounds are sealed in the sim. A `decide` goes into `table.sealed` and its event, `decided`, names only who chose. `close_round` reveals every choice at once in `round_closed`, in seat order, with `null` for a seat that played the default. Nothing depends on the order choices came in, so the first and the last in a window count the same.
- The server stamps the times, and the sim never compares them. The server fills in `open_table`'s salt and `at` and `start_game`'s `at` before logging, the way it fills in a putter's steps (decision 0049), and `close_round` carries the `at` of the next round. The sim keeps `openedAt` and `roundAt` for views and the server's runner and never compares them to anything, so the window lengths (`GAME_TIMES` in the protocol) are the server's word and changing them changes no logged game.
- The salt rides in `open_table`, not in a separate `table_salt` input as the RFC drafted. One input means no moment with a table and no salt, nothing to repair after a crash between two writes, and one log row fewer per table. The protocol's action has no `salt` field, so a resident can't pick one; a body that sends one is ignored. It's 128 bits from `crypto.getRandomValues`, part of the hashed world, and shown only in `game_over`.
- The server closes rounds. `WorldService.runGames` logs `close_round` once every seat has decided or is away (`roundSettled`), or once the window ends. It runs on every request's `tick`, after an accepted `decide` or `start_game`, and every second from both adapters (`Api.gameClock`). One `setInterval` started with the Durable Object holds it in memory no longer than the minute sweep already does; a timer re-armed each round would keep it alive forever.
- Away seats stop holding up rounds. After two missed rounds in a row a seat is away: it plays the default, rounds close without waiting for it, and its next `decide` brings it back. A table where every seat is away ends, places by the board.
- Tables stand at four spots in the Commons (`gameTableTiles`), two on each side of the square between the Town Hall and the shop. A new table takes the first with no table and no block; when all are in use, `open_table` is refused (`table_limit`). `sit` puts a resident on the open tile nearest the table. The spots don't stop walkers, so older logs walk as they did.
- Unstarted tables close after 30 minutes (live) or 12 hours (slow), logged as `close_table`. The RFC said a day for slow tables; with only four spots, a day let four waiting tables hold the Commons, and 12 hours still spans three check-ins.
- Spots can't be held cheaply. Only a resident with a hearth opens a table, one waiting at a time. A table with nobody left but townsfolk closes in the same `stand`, and the runner closes one that ends up that way some other way. The first seat that isn't townsfolk starts the game; once the table has had enough seats for 2 minutes (live) or 30 minutes (slow), the server stamps a `start_game` from any other seat with `free`, so a first seat that left can't keep the rest waiting. The grace counts from `readyAt`, which the `sit` that gave the table enough players sets from its stamped `at`, so it survives a restart.
- Townsfolk fill slow tables. A slow table still short of players an hour after it opened gets townsfolk in the seats it needs to start, never more, each sitting as themselves through `arrive`, like their coin tips. They play unrated and decide as soon as a round opens: one of their game's three lowest moves, by a hash of the salt, the round, and their id (`townsfolkMove`), logged as an ordinary `decide`. Nobody can foresee a pick while the salt is secret, and anyone can check every pick once `game_over` shows it. Live tables never get townsfolk.
- A Hearth race ends after 30 rounds with the furthest along first. With random play six seats take about 26 rounds to reach the hearth (2 seats take 8), so a cap keeps a slow race from running for days. Two seats arriving together go to the higher pick; the RFC's seat-order tiebreak can't come up, since a pick two seats share moves neither.

## Consequences

- Replay never runs a clock or a strategy: every round's close and every townsfolk pick is a logged input.
- The input log holds sealed choices, so a maintainer who exports it mid-round could read them. The export is for replay checks and maintainers only; staff are trusted with it the way they are with purses.
- Four spots cap tables world-wide until RFC 0010's events add tables on plots (RFC 0011 step 5).
- A game ends early only when every seat is away, so one player and townsfolk at a slow table play it out, the player's missed rounds at the default.
- Code: `sim/src/games.ts`, `server/src/games.ts`, `WorldService.runGames` and `perform` in `server/src/world-service.ts`, `Api.gameClock`, `protocol/src/games.ts`. Tests: `sim/src/games.test.ts`, `server/src/games.test.ts` (including that a choice reaches nobody through any read), `sim/src/fixtures/games-log.ts`.
