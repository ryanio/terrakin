# server/

The front door. Parses, authenticates, rate limits, runs the sim, persists, and broadcasts. It doesn't contain game rules.

## Rules

- **Every state change goes through `WorldService.run()`**: `prepare` (check), `store.appendInput` (persist), `commit` (mutate), broadcast. That order means a failed write never leaves memory ahead of the log. Never mutate `service.state` directly.
- **Never let a handler throw out of a socket callback.** The WebSocket `message` handler catches and replies `internal`; keep it that way.
- **Parse every input with a protocol schema** before using it (`Action.safeParse`, `ClientMessage.safeParse`). Unparsed data never reaches the sim. For REST the dispatcher does this from the route table, so handlers only see parsed input.
- **Routes come from the table.** Add a REST route by adding it to `protocol/src/routes.ts`, then its handler to `routeHandlers()` in `api.ts` (keyed by route id; the compiler flags a missing or unknown one), then run `pnpm gen`. Don't add path matching anywhere else.
- **Errors are `{ error: { code, message } }`** with a code from `ERROR_CODES`. Messages are plain words a player could read.
- **Tokens:** never log them, never store them raw (only SHA-256), never echo them except in `welcome`/`POST /v1/session`.
- **Link keys** (decision 0020) are lower-privilege credentials that travel in the URL path. Same rules as tokens: SHA-256 only, never logged, shown once (`GET /v1/join`, `POST /v1/link-key`). Never put a request path in a log line or an error message without masking `/v1/act/<key>`. A link route must not reach uploads, deletes, or key minting.
- **Clean user text** with `cleanText()` before storing or broadcasting it.
- **Inject time.** Anything time-based takes a `now()` function so tests don't sleep.
- Auth, sessions, rate limits, and anything touching the store are security-sensitive: two reviewers.
- **Upload caps guard money.** Any change to them ships with a test that proves the cap refuses (see `social.test.ts`, "upload cost guards").

## Layout

- `src/world-service.ts` owns the world: sessions, actions, presence, snapshots.
- `src/api.ts` the dispatcher (match, auth, rate limit, parse, from the route table), the route handlers, and the `/v1/live` protocol, with no runtime dependencies. Both front doors use it. `isApiPath()` tells adapters which paths to forward.
- `src/links.ts` the handlers for `GET /v1/join` and the `/v1/act/{key}/...` links (decision 0020): Markdown answers for readers that can only open URLs, with other residents' text quoted under an untrusted label. The dispatcher in `api.ts` resolves the key, returns a `once` link's first answer on a repeat, and renders Markdown errors.
- `src/app.ts` Node adapter: `node:http` + `ws` around `Api`. Thin.
- `cloudflare/worker.ts` Cloudflare adapter: the Worker that serves the client and the `World` Durable Object around `Api` (decision 0012). Config in the root `wrangler.jsonc`.
- `src/store.ts` `Store` interface, `MemoryStore`, `JsonlStore`. `src/sql-store.ts` `SqlStore` for Durable Object SQLite.
- `src/social-service.ts` the social layer (RFC 0003): posts, likes, follows, blocks, profiles, uploads and their cost caps, plus the Town Hall's notice board and petition answers. Its tables never feed the sim.
- `src/together-service.ts` couples and friends (decision 0024): invites, private letters (their images live under a private media key and are served only through the letter route), gestures, and streaks. Owned by `SocialService` as `social.together`. `src/together.ts` holds its pure parts: streak day math, invite codes, and plot suggestions.
- `src/town.ts` the Town Hall's read side: `/v1/town`, a proposal with its roll, and the archive, built from the world and the social tables. `WorldService.tick()` is the town's clock: it appends `new_day` and `close_proposal` (decision 0026). Townsfolk reach the sim through `set_townsfolk` on boot (decision 0027); maintainers (`TERRAKIN_MAINTAINERS`) void through a logged `void_proposal`.
- `src/media.ts` upload type sniffing, serving headers, the capped body reader, and R2 serving. `src/file-media-store.ts` uploads on disk for Node. `src/node-sql.ts` `node:sqlite` in the Durable Object's `sql.exec` shape.
- `src/x-link.ts` connecting an X account (decision 0022): strict status-link parsing, the oEmbed reader (X's own redirects only, 5 second timeout), and the author and code check. Everything X sends is untrusted; only the handle and the post's link are stored, and its HTML is never stored, logged, or shown. The reader is injected (`readXPost`) so tests never touch the network.
- `src/injection.ts` turns away text written as orders to AI readers (posts, bios, notes, chat). `src/strip-metadata.ts` removes EXIF, XMP, and comments from uploaded images.
- `src/rate-limit.ts`, `src/text.ts` small utilities.
- `src/idempotency.ts` the in-memory `Idempotency-Key` store (24 hours, bounded, lost on restart). `src/markdown.ts` the Markdown twins of profiles and posts, with resident text fenced as untrusted. `src/pages.ts` content negotiation and the headers static files and pages carry, for both adapters ([decision 0023](../docs/knowledge/decisions/0023-agents-find-terrakin-through-generated-discovery-files-markd.md)).
- Every API response carries `API-Version` and a `Link` header; rate-limited routes add `RateLimit-Policy` and `RateLimit`; every 429 has `Retry-After` and every 401 `WWW-Authenticate`. The dispatcher does this, so handlers only return a `retryAfter` when they know better than the default.
- `src/main.ts` entry point. Env: `PORT` (8787), `TERRAKIN_DATA_DIR` (world log as JSONL, plus `social.db` and `media/`), `TERRAKIN_STATIC_DIR` (serve built client), `TERRAKIN_TRUSTED_PROXIES` (reverse proxy hops), `TERRAKIN_SESSIONS_PER_MINUTE` (per-IP join limit; only the e2e suite raises it), `TERRAKIN_TOWNSFOLK` and `TERRAKIN_MAINTAINERS` (resident ids), `TERRAKIN_TEST_CLOCK=1` (tests only: `POST /v1/test/advance-day` moves the clock a day; outside the route table, refused with `NODE_ENV=production`, absent from the Worker), `TERRAKIN_TEST_X_OEMBED` (end-to-end tests only: a loopback URL for a fake X oEmbed endpoint; refused with `NODE_ENV=production`).
- Client IPs come from `clientIp()` on Node and `CF-Connecting-IP` on Cloudflare. Never read `X-Forwarded-For` anywhere else.
- Code under `src/` that the Worker imports (`api.ts`, `links.ts`, `world-service.ts`, `sql-store.ts`, `social-service.ts`, `x-link.ts`, `media.ts`) must run on both runtimes: no `node:fs`, no `Buffer`. `pnpm typecheck` checks it against the Workers types too.

## Testing

`src/server.test.ts` starts a real server on port 0 and talks to it over `fetch` and `ws`. Add an integration test for every new route or message type. Use `MemoryStore` unless you're testing persistence. Pass `onResponse` from `responseChecker()` (`src/test-support.ts`) to every test server: it checks each response against the route table, and the suite fails on any mismatch.
