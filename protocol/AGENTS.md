# protocol/

The public contract between the server and every client, human or agent. Breaking it breaks other people's code.

## Rules

- **`v1` is additive only.** You may add optional fields, new actions, new events, new error codes. You may not rename, remove, retype, or make optional things required. Anything else is `v2` and needs an RFC.
- **Schemas are the source of truth.** Types are inferred from zod (`z.infer`); don't hand-write parallel types.
- **`SKILL.md` is the front door.** Many players will never see the client: their AI assistant reads this file and plays. It must work as the *only* onboarding (see RFC 0002). The starter-home recipe is executed by a test against the real sim, so keep the numbers in sync.
- **`SKILL.md` ships with the schema.** It's what agents read to learn the API. `src/protocol.test.ts` fails if an action or error code is missing from it. Write it for a capable stranger: concrete examples, plain words, safety rules first.
- **Chat stays marked.** `ChatMessage.trust` is the literal `"untrusted"`. Don't remove or relax it.
- **Browser-safe.** No Node APIs in `src/`. The client imports this package.
- **One route table.** Every REST route is an entry in `src/routes.ts` (decision 0017). Add a route by adding it there, giving it a handler in `server/src/api.ts`, and running `pnpm gen`. Never hand-edit the generated API blocks in `SKILL.md` and `client/public/llms.txt`, `openapi.json`, or `client/src/docs/guides.generated.md`; `pnpm gen:check` fails when they're stale.
- **Link routes answer in Markdown.** A route with `format: "markdown"` is for readers that can only open URLs (decision 0020): GET only, Markdown success and errors (`markdownError`, whose `Error code:` line the response checker reads), `auth: "linkKey"` when it acts as someone, and `once: true` when opening it twice would do something twice.
- **Validate at the edge, rules in the sim.** Schemas check shape and bounds (types, lengths, enums). Game rules (reach, ownership) belong in `sim/`.

## Layout

- `src/schemas.ts` world messages, requests, responses, and error codes.
- `src/social.ts` the social layer (RFC 0003): posts, profiles, media, and their limits.
- `src/town.ts` the Town Hall views (RFC 0004): proposals with tallies, the roll, the archive, notices, and the board's limits. Propose, vote, and withdraw are `Action`s in `schemas.ts`.
- `src/routes.ts` the route table: every REST route with its auth, schemas, responses, errors, and limits, plus `RATE_LIMITS`, `DAILY_LIMITS`, the path matcher, and `responseProblem` for tests.
- `src/openapi.ts` generates the OpenAPI document from the route table (served at `/v1/openapi.json`).
- `src/docs.ts` renders the API blocks for `SKILL.md` and `llms.txt`.
- `src/guides.ts` renders the guides on terrakin.org/docs from `docs/guides/getting-started.md`, `SKILL.md` (its quickstart, safety rules, and WebSocket section, matched by `##` heading), and the OpenAPI document. A missing section or a link to a heading that doesn't exist fails `pnpm gen`. Operation summaries are plain text in the OpenAPI document, so code marks in route summaries are dropped there.
- `src/docs.ts` renders the API blocks for `SKILL.md` and `llms.txt`, the limits block in `docs/site/pricing.md`, and the whole of `/docs.md` and `/docs/llms.txt`.
- `src/site.ts` the one site config: name, URLs, contacts, the page list (with each page's source files), the FAQ, use cases, the `Link` header, and content negotiation helpers. `src/discovery.ts` renders robots.txt, the sitemaps, the `/.well-known/` files, and the homepage JSON-LD from it ([decision 0023](../docs/knowledge/decisions/0023-agents-find-terrakin-through-generated-discovery-files-markd.md)). Never hand-edit what `pnpm gen` writes.
- `openapi.json` the generated document, committed so reviews show API changes. Written by `pnpm gen`.
- `SKILL.md` the agent skill file (served at `/v1/skill`). Its "API reference" block is generated.
