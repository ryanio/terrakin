# server/

The front door. Parses, authenticates, rate limits, runs the sim, persists, and broadcasts. It holds no game rules. How the pieces fit: [docs/architecture.md](../docs/architecture.md).

## Rules

- **Every world change goes through `WorldService.run()`**: `prepare` (check), `store.appendInput` (persist), `commit` (mutate), broadcast. A failed write never leaves memory ahead of the log. Never mutate `service.state` directly.
- **Routes come from the table.** Add the route to `protocol/src/routes.ts`, its handler to `routeHandlers()` in `api.ts`, then run `pnpm gen`. No path matching anywhere else. The dispatcher parses every input with the protocol schemas, so handlers only see parsed data.
- **Errors are `{ error: { code, message } }`** with a code from `ERROR_CODES` and a message a player could read.
- **Never throw out of a socket callback.** The `message` handler catches and replies `internal`; keep it that way.
- **Tokens and link keys** are stored as SHA-256 only, never logged, and shown once. Link keys travel in the URL path, so mask `/v1/act/<key>` before a path reaches a log line or an error. A link route must not reach uploads, deletes, or key minting.
- **Resident text** goes through `cleanText()` before it's stored or broadcast, and `injection.ts` turns away text written as orders to AI readers ([decision 0014](../docs/knowledge/decisions/0014-turn-away-text-aimed-at-ai-readers-and-strip-image-metadata.md)). Page meta writes resident text only through escaping APIs.
- **Anything X sends is untrusted.** Store only the handle and the post link; never store, log, or show its HTML ([decision 0022](../docs/knowledge/decisions/0022-connect-an-x-account-by-reading-a-public-post-no-oauth.md)).
- **Inject time and the network.** Anything time-based takes a `now()`; the X reader is injected (`readXPost`), so tests never sleep or touch the network.
- **Client IPs** come from `clientIp()` on Node and `CF-Connecting-IP` on Cloudflare. Never read `X-Forwarded-For` anywhere else.
- **Both runtimes.** Code the Worker imports (`api.ts`, `links.ts`, `world-service.ts`, `sql-store.ts`, `social-service.ts`, `x-link.ts`, `media.ts`, and what they import) uses no `node:fs` and no `Buffer`. `pnpm typecheck` checks it against the Workers types.
- **Caps that guard money ship with a test that proves they refuse** (see "upload cost guards" in `social.test.ts`). Auth, sessions, rate limits, and the store are security-sensitive: run the `reviewer` subagent.
- **Cards are drawn in the Worker, never in the World object.**
- **A new client route needs a case in `matchPage`** (`src/page-meta.ts`), or its HTML goes out as a 404 with `noindex`.

## Where things are

- `src/api.ts` the dispatcher (match, auth, rate limit, parse, response headers), the route handlers, and the `/v1/live` socket protocol. Both adapters wrap it.
- `src/app.ts` the Node adapter. `cloudflare/worker.ts` the Worker and the `World` Durable Object ([decision 0012](../docs/knowledge/decisions/0012-host-on-cloudflare-workers-with-one-durable-object.md)); config in the root `wrangler.jsonc`.
- `src/world-service.ts` the world: sessions, actions, presence, snapshots, and `tick()`, the Town Hall's clock.
- `src/store.ts` `MemoryStore` and `JsonlStore`. `src/sql-store.ts` Durable Object SQLite. `src/node-sql.ts` `node:sqlite` in the same shape.
- `src/social-service.ts` posts, likes, follows, blocks, profiles, uploads and their caps, look media, and the notice board. Its tables never feed the sim.
- `src/together-service.ts` and `src/together.ts` invites, private letters, gestures, streaks ([decision 0024](../docs/knowledge/decisions/0024-invites-letters-and-gestures-for-couples-and-friends.md)).
- `src/town.ts` the Town Hall read side (`/v1/town`, proposals, the archive).
- `src/links.ts` `GET /v1/join` and the `/v1/act/{key}/...` link handlers.
- `src/media.ts` upload sniffing, the capped body reader, serving headers. `src/strip-metadata.ts` strips EXIF and XMP. `src/file-media-store.ts` uploads on disk for Node.
- `src/x-link.ts` connecting an X account through oEmbed.
- `src/page-meta.ts` per-page title, Open Graph, JSON-LD, and `<noscript>` copy; `cloudflare/meta-rewriter.ts` and `src/meta-html.ts` apply it. `src/og.ts` the `/og/...png` card route and its render cap ([decision 0028](../docs/knowledge/decisions/0028-link-preview-cards-and-page-meta-at-the-edge.md)).
- `src/pages.ts` content negotiation and static-file headers. `src/markdown.ts` Markdown twins of profiles and posts. `src/idempotency.ts` the `Idempotency-Key` store.
- `src/main.ts` the Node entry point. Every env var it reads is in the settings table in [docs/deploy.md](../docs/deploy.md); add new ones there. `TERRAKIN_TEST_CLOCK` and `TERRAKIN_TEST_X_OEMBED` are for tests only and refuse to run with `NODE_ENV=production`.

## Testing

`src/server.test.ts` starts a real server on port 0 and talks to it over `fetch` and `ws`. Every new route or message type gets an integration test. Use `MemoryStore` unless you're testing persistence. Pass `onResponse` from `responseChecker()` (`src/test-support.ts`) to every test server; it checks each response against the route table and fails the suite on a mismatch.
