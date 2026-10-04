# server/

The front door. Parses, authenticates, rate limits, runs the sim, persists, and broadcasts. It doesn't contain game rules.

## Rules

- **Every state change goes through `WorldService.run()`**: `prepare` (check), `store.appendInput` (persist), `commit` (mutate), broadcast. That order means a failed write never leaves memory ahead of the log. Never mutate `service.state` directly.
- **Never let a handler throw out of a socket callback.** The WebSocket `message` handler catches and replies `internal`; keep it that way.
- **Parse every input with a protocol schema** before using it (`Action.safeParse`, `ClientMessage.safeParse`). Unparsed data never reaches the sim.
- **Errors are `{ error: { code, message } }`** with a code from `ERROR_CODES`. Messages are plain words a player could read.
- **Tokens:** never log them, never store them raw (only SHA-256), never echo them except in `welcome`/`POST /v1/session`.
- **Clean user text** with `cleanText()` before storing or broadcasting it.
- **Inject time.** Anything time-based takes a `now()` function so tests don't sleep.
- Auth, sessions, rate limits, and anything touching the store are security-sensitive: two reviewers.

## Layout

- `src/world-service.ts` owns the world: sessions, actions, presence, snapshots.
- `src/app.ts` HTTP routes and the `/v1/live` WebSocket. Thin.
- `src/store.ts` `Store` interface, `MemoryStore`, `JsonlStore`.
- `src/rate-limit.ts`, `src/text.ts` small utilities.
- `src/main.ts` entry point. Env: `PORT` (8787), `TERRAKIN_DATA_DIR` (persist to JSONL), `TERRAKIN_STATIC_DIR` (serve built client), `TERRAKIN_TRUSTED_PROXIES` (reverse proxy hops).
- Client IPs come from `clientIp()`. Never read `X-Forwarded-For` anywhere else.

## Testing

`src/server.test.ts` starts a real server on port 0 and talks to it over `fetch` and `ws`. Add an integration test for every new route or message type. Use `MemoryStore` unless you're testing persistence.
