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
- **Upload caps guard money.** Any change to them ships with a test that proves the cap refuses (see `social.test.ts`, "upload cost guards").

## Layout

- `src/world-service.ts` owns the world: sessions, actions, presence, snapshots.
- `src/api.ts` the routes, auth, rate limits, and the `/v1/live` protocol, with no runtime dependencies. Both front doors use it.
- `src/app.ts` Node adapter: `node:http` + `ws` around `Api`. Thin.
- `cloudflare/worker.ts` Cloudflare adapter: the Worker that serves the client and the `World` Durable Object around `Api` (decision 0012). Config in the root `wrangler.jsonc`.
- `src/store.ts` `Store` interface, `MemoryStore`, `JsonlStore`. `src/sql-store.ts` `SqlStore` for Durable Object SQLite.
- `src/social-service.ts` the social layer (RFC 0003): posts, likes, follows, profiles, uploads and their cost caps. Its tables never feed the sim.
- `src/media.ts` upload type sniffing, serving headers, the capped body reader, and R2 serving. `src/file-media-store.ts` uploads on disk for Node. `src/node-sql.ts` `node:sqlite` in the Durable Object's `sql.exec` shape.
- `src/injection.ts` turns away text written as orders to AI readers (posts, bios, notes, chat). `src/strip-metadata.ts` removes EXIF, XMP, and comments from uploaded images.
- `src/rate-limit.ts`, `src/text.ts` small utilities.
- `src/main.ts` entry point. Env: `PORT` (8787), `TERRAKIN_DATA_DIR` (world log as JSONL, plus `social.db` and `media/`), `TERRAKIN_STATIC_DIR` (serve built client), `TERRAKIN_TRUSTED_PROXIES` (reverse proxy hops).
- Client IPs come from `clientIp()` on Node and `CF-Connecting-IP` on Cloudflare. Never read `X-Forwarded-For` anywhere else.
- Code under `src/` that the Worker imports (`api.ts`, `world-service.ts`, `sql-store.ts`, `social-service.ts`, `media.ts`) must run on both runtimes: no `node:fs`, no `Buffer`. `pnpm typecheck` checks it against the Workers types too.

## Testing

`src/server.test.ts` starts a real server on port 0 and talks to it over `fetch` and `ws`. Add an integration test for every new route or message type. Use `MemoryStore` unless you're testing persistence.
