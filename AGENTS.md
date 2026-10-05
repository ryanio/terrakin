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
3. **Server-authoritative.** Rules live in `sim/`. The server validates everything; the client only renders.
4. **Deterministic sim.** No clocks, randomness, or I/O in `sim/`. Same log in, same world out.
5. **Tests for numbers.** Economy, progression, limits, and sim rules are proven by tests. Code that guards money (upload caps, rate limits) ships with a test that shows the guard refuses.
6. **Resident text is untrusted.** Chat, names, posts, and notes never become an action or a grant, and reach the DOM only as text ([decision 0004](docs/knowledge/decisions/0004-chat-is-untrusted-data.md)).
7. **Protocol is a contract.** `v1` changes are additive only, and `protocol/SKILL.md` changes with them (a test enforces it).
8. **Generated files are generated.** Run `pnpm gen` after touching routes, the site config, `SKILL.md`, or `docs/site/`; never hand-edit its output.
9. **Plain words, no em dashes** in user-facing copy and docs.
10. **No secrets** in code, logs, docs, commits, or the knowledge base. The repo is public, so never point docs, plans, handoffs or code at files on a maintainer's machine (`~/Desktop`, `/Users/...`); write the content in, or say "kept privately" with no path. Check with `git grep -nE "~/Desktop|/Users/"` before committing docs (existing hits are examples).
11. **Reuse before you build.** Before writing UI, check `ui/` ([ui/AGENTS.md](ui/AGENTS.md)) for a component or helper that already does it: layout (`stack`, `cluster`), list rows (`itemRow`), avatars, people links, times, cards, sheets, menus, copy, chips, error lines, busy and "show more" buttons, disclosures and dropdowns, polling, paths, motion, brand colors. If something you need exists in one view, move it into `ui/` and use it from both; never copy it. Styles for a shared piece live in `ui/src/base.css`; colors, spacing, type sizes and corners come from tokens. `client/src/shared-components.test.ts` fails on known copies; when you add a shared piece, add its pattern there.

## Words

Plot (owned land), hearth (home tile), kindred (clan), coins (earned currency), season (about 3 months), the Commons (shared land), townsfolk (the founding NPC residents). Personas: homesteader, delver, host, champion. Full table: [founding plan, section 3](docs/plans/founding-plan.md#3-terminology-no-game-knowledge-required).

## Map

| Path | What |
|------|------|
| [`sim/`](sim/AGENTS.md) | Deterministic rules engine. The only place game rules live. |
| [`protocol/`](protocol/AGENTS.md) | API v1: schemas, the route table, OpenAPI, and `SKILL.md` (the onboarding for AI assistants). |
| [`server/`](server/AGENTS.md) | HTTP and WebSocket front door, persistence, social tables. Runs on Node and as the Cloudflare Worker behind terrakin.org. |
| [`client/`](client/AGENTS.md) | Mobile-first web client and the `/docs` page. Renders, never decides. |
| [`admin/`](admin/AGENTS.md) | The staff app at admin.terrakin.org: review queue, AI triage suggestions, moderation log. Behind Cloudflare Access. |
| [`ui/`](ui/AGENTS.md) | `@terrakin/ui`: the components, styles, design tokens, DOM helpers, and request helper `client/` and `admin/` share. Build a piece once, here. |
| [`cards/`](cards/AGENTS.md) | Link preview cards, drawn with satori and resvg-wasm. |
| [`e2e/`](e2e/AGENTS.md) | Playwright tests on a phone viewport against the real build. |
| [`scripts/`](scripts/AGENTS.md) | Repo tooling: `gen`, `kb`, the brand generator, the coin simulation, the townsfolk seed and tips, and the Sentry reader. |
| [`docs/`](docs/AGENTS.md) | Vision, plans, architecture, RFCs, guides, site pages, knowledge base. |

Dependencies point one way: `client -> ui -> protocol -> sim` (client and ui also import sim directly), `admin -> ui -> protocol`, `server -> protocol -> sim`, and `server -> cards`. `sim` and `cards` depend on nothing.

## Commands

```sh
pnpm dev          # server :8787 + client :5173 + staff app :5174 (proxied), hot reload
pnpm verify       # vendored secrets check, lint, typecheck, test, kb:check, gen:check, build. Same as CI.
pnpm vitest run --project sim   # one package's tests
pnpm e2e          # Playwright on a phone viewport against the real build
pnpm format       # Biome: fix formatting and safe lint issues
pnpm gen          # regenerate everything derived from the route table and site config
pnpm kb           # rebuild the knowledge index
pnpm cf:deploy    # deploy to terrakin.org by hand; main also deploys itself once CI passes (docs/deploy.md)
```

## Definition of done

1. `pnpm verify` passes (and `pnpm e2e` for client changes).
2. New behavior has a test at the lowest level that catches the bug: sim rule in `sim/`, wire format in `protocol/`, routing and auth in `server/`, a user flow in `e2e/`.
3. Docs that describe the behavior change in the same commit: the folder `AGENTS.md`, `SKILL.md`, `docs/architecture.md`, `docs/plans/README.md`.
4. Notable changes (new routes, fields, actions, behavior agents would notice, deprecations, removals, security fixes) get a `CHANGELOG.md` entry in the same push. Deprecations name the replacement and the earliest removal date; v1 never removes anything without a deprecation entry first. `pnpm gen:check` fails when the API changed and the changelog didn't ([decision 0036](docs/knowledge/decisions/0036-the-agent-changelog-is-one-file-published-as-a-page-a-feed-a.md)).
5. A choice someone could question has a decision record (`pnpm kb new decision "..."`).
6. Work left in flight has a handoff (`pnpm kb new handoff "..."`).
