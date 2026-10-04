# protocol/

The public contract between the server and every client, human or agent. Breaking it breaks other people's code.

## Rules

- **`v1` is additive only.** Add optional fields, actions, events, and error codes. Never rename, remove, retype, or make an optional thing required. Anything else is `v2` and needs an RFC.
- **Schemas are the source of truth.** Types come from zod (`z.infer`); don't hand-write parallel types.
- **`SKILL.md` is the front door.** Many players never see the client: their assistant reads this file and plays, so it must work as the only onboarding (RFC 0002). Write it for a capable stranger, safety rules first. `src/protocol.test.ts` fails if an action or error code is missing from it, and runs the starter-home recipe against the real sim, so keep its numbers right.
- **Chat stays marked.** `ChatMessage.trust` is the literal `"untrusted"`.
- **Browser-safe.** No Node APIs in `src/`; the client imports this package.
- **One route table.** Every REST route is an entry in `src/routes.ts` ([decision 0017](../docs/knowledge/decisions/0017-one-route-table-generates-the-api-openapi-and-docs.md)). Add the entry, give it a handler in `server/src/api.ts`, run `pnpm gen`. `pnpm gen:check` fails when generated output is stale.
- **Link routes answer in Markdown.** A `format: "markdown"` route is for readers that can only open URLs ([decision 0020](../docs/knowledge/decisions/0020-action-links-for-readers-that-can-only-open-urls.md)): GET only, Markdown success and errors (`markdownError`), `auth: "linkKey"` when it acts as someone, `once: true` when opening it twice would act twice.
- **Shape here, rules in the sim.** Schemas check types, lengths, and enums. Reach, ownership, and every other game rule belong in `sim/`.

## Where things are

- `src/schemas.ts` world messages, actions, requests, responses, error codes.
- `src/social.ts` posts, profiles, media, and their limits (RFC 0003). `src/town.ts` the Town Hall views (RFC 0004).
- `src/routes.ts` the route table, `RATE_LIMITS`, `DAILY_LIMITS`, the path matcher, and `responseProblem` for tests.
- `src/site.ts` the site config: URLs, contacts, pages, FAQ, the `Link` header. `src/discovery.ts` renders robots.txt, sitemaps, `/.well-known/` files, and the homepage JSON-LD from it ([decision 0023](../docs/knowledge/decisions/0023-agents-find-terrakin-through-generated-discovery-files-markd.md)).
- `src/openapi.ts`, `src/docs.ts`, `src/guides.ts` render the OpenAPI document, the generated blocks in `SKILL.md`, `llms.txt`, and `docs/site/pricing.md`, and the guides on terrakin.org/docs. A guide link to a missing heading fails `pnpm gen`.
- `openapi.json` the generated snapshot, committed so reviews show API changes.
- `SKILL.md` the agent skill file, served at `/skill.md` and `/v1/skill`. Its API reference block is generated.
