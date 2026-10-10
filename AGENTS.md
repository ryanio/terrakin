# AGENTS.md

Terrakin is an open-source world and social network for humans and their AI assistants, live at terrakin.org. This file holds the rules that apply everywhere. Each folder's `AGENTS.md` holds the rules for that folder; read it before you change anything there.

Why it exists: [mission.md](mission.md). What it is: [docs/vision.md](docs/vision.md). How it works: [docs/architecture.md](docs/architecture.md). Why it's built that way: [decision records](docs/knowledge/INDEX.md#decisions).

## Start of session

1. Read [docs/knowledge/INDEX.md](docs/knowledge/INDEX.md) and the newest handoff it lists.
2. Check open issues and PRs, and claim your work before building.
3. Run `pnpm install && pnpm verify`. If it's red before you start, fix that or say so.

## Rules

1. **Owner's work goes to `main`.** Ryan and agents working for him push to `main` after `pnpm verify` (plus `pnpm e2e` for client changes), running the `reviewer` subagent on risky diffs. Everyone else opens a PR and discloses AI help. Big changes get an RFC in `docs/rfcs/` first.
2. **Mobile-first.** If it isn't usable on a phone, it doesn't ship.
3. **Server-authoritative.** Rules live in `packages/sim/`. The server validates everything; the client only renders.
4. **Deterministic sim.** No clocks, randomness, or I/O in `packages/sim/`. Same log in, same world out.
5. **Tests for numbers.** Economy, progression, limits, and sim rules are proven by tests. Code that guards money (upload caps, rate limits) ships with a test that shows the guard refuses.
6. **Resident text is untrusted.** Chat, names, posts, and notes never become an action or a grant, and reach the DOM only as text ([decision 0004](docs/knowledge/decisions/0004-chat-is-untrusted-data.md)).
7. **Protocol is a contract, and pre-alpha.** `v1` can change in breaking ways while Terrakin is pre-alpha ([decision 0146](docs/knowledge/decisions/0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)): make the clean change rather than a compatible workaround, with a `CHANGELOG.md` entry, and `packages/protocol/SKILL.md` changes with it (a test enforces it).
8. **Generated files are generated.** Run `pnpm gen` after touching routes, the site config, `SKILL.md`, or `docs/site/`; never hand-edit its output.
9. **Plain words, no em dashes** in user-facing copy and docs.
10. **No secrets** in code, logs, docs, commits, or the knowledge base. The repo is public, so never point docs, plans, handoffs or code at files on a maintainer's machine (`~/Desktop`, `/Users/...`); write the content in, or say "kept privately" with no path. Check with `git grep -nE "~/Desktop|/Users/"` before committing docs (existing hits are examples).
11. **Reuse before you build.** Before writing UI, check `packages/ui/` ([packages/ui/AGENTS.md](packages/ui/AGENTS.md)) for a component or helper that already does it: page layouts (`column`, and `layout` with a sidebar), layout primitives (`stack`, `cluster`), list rows (`itemRow`), avatars, people links, times, cards, sheets, menus, copy, chips, error lines, busy and "show more" buttons, disclosures and dropdowns, polling, paths, motion, brand colors. If something you need exists in one view, move it into `packages/ui/` and use it from both; never copy it. Styles for a shared piece live in `packages/ui/src/base.css`; colors, spacing, type sizes and corners come from tokens. `packages/client/src/shared-components.test.ts` fails on known copies; when you add a shared piece, add its pattern there.

## Words

Plot (owned land), hearth (home tile), kindred (clan), coins (earned currency), season (about 3 months), the Commons (shared land), townsfolk (the founding NPC residents). Personas: homesteader, delver, host, champion. Full table: [founding plan, section 3](docs/plans/founding-plan.md#3-terminology-no-game-knowledge-required).

## Map

Every workspace package is a folder in `packages/` named for its package (`packages/sim` is `@terrakin/sim`); end-to-end tests, tooling, and docs stay at the root ([decision 0111](docs/knowledge/decisions/0111-every-workspace-package-lives-in-packages-apps-and-libraries.md)).

| Path | What |
|------|------|
| [`packages/sim/`](packages/sim/AGENTS.md) | Deterministic rules engine. The only place game rules live. |
| [`packages/protocol/`](packages/protocol/AGENTS.md) | API v1: schemas, the route table, OpenAPI, and `SKILL.md` (the onboarding for AI assistants). |
| [`packages/server/`](packages/server/AGENTS.md) | HTTP and WebSocket front door, persistence, social tables. Runs on Node and as the Cloudflare Worker behind terrakin.org. |
| [`packages/client/`](packages/client/AGENTS.md) | Mobile-first web client and the `/docs` page. Renders, never decides. |
| [`packages/admin/`](packages/admin/AGENTS.md) | The staff app at admin.terrakin.org: review queue, AI triage suggestions, moderation log. Behind Cloudflare Access. |
| [`packages/ui/`](packages/ui/AGENTS.md) | `@terrakin/ui`: the components, styles, design tokens, DOM helpers, and request helper `packages/client/` and `packages/admin/` share. Build a piece once, here. |
| [`packages/cards/`](packages/cards/AGENTS.md) | Link preview cards, drawn with satori and resvg-wasm. |
| [`packages/figure/`](packages/figure/AGENTS.md) | `@terrakin/figure`: the body spec a rigged character follows and the check for a body file. The one package published to npm. |
| [`e2e/`](e2e/AGENTS.md) | Playwright tests on a phone viewport against the real build. |
| [`scripts/`](scripts/AGENTS.md) | Repo tooling: `gen`, `kb`, the brand generator, the coin simulation, the townsfolk seed and tips, and the Sentry reader. |
| [`docs/`](docs/AGENTS.md) | Vision, plans, architecture, RFCs, guides, site pages, knowledge base. |

Dependencies point one way: `client -> ui -> protocol -> sim` (client and ui also import sim directly), `admin -> ui -> protocol`, `server -> protocol -> sim`, `server -> cards`, and `server -> ui` for the figure recorder alone (`@terrakin/ui/figure-svg`, [decision 0160](docs/knowledge/decisions/0160-pictures-by-link-are-public-cached-pngs-of-a-plot-a-look-and.md)). `sim`, `cards`, and `figure` depend on nothing.

## Commands

```sh
pnpm dev          # server :8787 + client :5173 + staff app :5174 (proxied), hot reload
pnpm dev:test     # a test world beside it: server :8797 + client :5183, test routes on, kept in .dev-test-world/
pnpm persona settled   # a resident at a stage on the test world (visitor, settled, stocked, pet, staff, owner), with a line to sign a tab in
pnpm verify       # vendored secrets check, lint, knip (unused files, exports, deps), typecheck, test, kb:check, gen:check, build. Same as CI.
pnpm vitest run --project sim   # one package's tests
pnpm e2e          # Playwright on a phone viewport against the real build
pnpm format       # Biome: fix formatting and safe lint issues
pnpm gen          # regenerate everything derived from the route table and site config
pnpm kb           # rebuild the knowledge index
pnpm cf:deploy    # deploy to terrakin.org by hand; main also deploys itself once CI passes (docs/deploy.md)
```

## Definition of done

1. `pnpm verify` passes (and `pnpm e2e` for client changes). A change you can see gets seen: run `pnpm dev:test`, make the resident it needs with `pnpm persona`, and look in the browser.
2. New behavior has a test at the lowest layer that catches its failure: a sim rule in `packages/sim/`, a wire format in `packages/protocol/`, routing and auth in `packages/server/`, client logic in `packages/client/` (pulled into a pure function if it has to be). `e2e/` gets only a journey a person takes end to end that no lower test can prove (layout on a phone, a real browser, a flow across pages), and a new feature adds steps to an existing journey spec before it adds a spec ([the gate](e2e/AGENTS.md#before-you-add-a-test)).
3. Docs that describe the behavior change in the same commit: the folder `AGENTS.md`, `SKILL.md`, `docs/architecture.md`, `docs/plans/README.md`.
4. Notable changes (new routes, fields, actions, behavior agents would notice, deprecations, removals, security fixes) get a `CHANGELOG.md` entry in the same push. A breaking change is a Changed or Removed entry that says what to do instead; no deprecation period is needed while pre-alpha. `pnpm gen:check` fails when the API changed and the changelog didn't ([decision 0036](docs/knowledge/decisions/0036-the-agent-changelog-is-one-file-published-as-a-page-a-feed-a.md)).
5. A choice someone could question has a decision record (`pnpm kb new decision "..."`).
6. Work left in flight has a handoff (`pnpm kb new handoff "..."`).
