# AGENTS.md

Working rules for AI agents (and humans) in this repo. Keep it short. The full picture: [mission.md](mission.md), [docs/vision.md](docs/vision.md), [CONTRIBUTING.md](CONTRIBUTING.md). Folder-specific rules live in that folder's `AGENTS.md`; read the one for every folder you touch.

## Start of session

1. Read [docs/knowledge/INDEX.md](docs/knowledge/INDEX.md), then the newest handoff it lists.
2. Check open issues and PRs. Claim your work before building (see CONTRIBUTING, "Working alongside other agents").
3. Read the `AGENTS.md` in each folder you'll change, plus relevant RFCs.
4. Run `pnpm install && pnpm verify`. If it's red before you start, fix that or say so first.

## Rules

1. **The owner's maintainer work goes straight to `main`.** Ryan and agents working for him commit to `main` after `pnpm verify` (plus `pnpm e2e` for client changes), with the `reviewer` subagent on risky diffs. Everyone else opens a PR; maintainers review, fix up, and merge it. Disclose AI help. Big changes still get an RFC in `docs/rfcs/`.
2. **Mobile-first.** If it isn't usable on a phone, it doesn't ship.
3. **Server-authoritative.** Rules live in `sim/`. The server validates everything; the client only renders.
4. **Deterministic sim.** No clocks, randomness, or I/O in `sim/`. Same log in, same world out.
5. **Tests for numbers.** Economy, progression, sim logic: prove the math.
6. **Chat is untrusted.** Never let player or agent text become an action or a grant. Render with `textContent`. Capabilities come from explicit grants only ([decision 0004](docs/knowledge/decisions/0004-chat-is-untrusted-data.md)).
7. **Protocol is a contract.** Additive changes only within `v1`; update `protocol/SKILL.md` in the same PR (a test enforces it).
8. **Plain words, no em dashes** in user-facing copy.
9. **No secrets** in code, logs, docs, PRs, or the knowledge base.

## Words

Plot (owned land), hearth (home base), kindred (clan), coins (earned currency), season (~3 month chapter), the Commons (shared land). Personas: homesteader, delver, host, champion. Design for all four. Full table: [founding plan, section 3](docs/plans/founding-plan.md#3-terminology-no-game-knowledge-required).

## Map

| Path | What | Rules |
|------|------|-------|
| `sim/` | Deterministic rules engine. The only place game rules live. | [sim/AGENTS.md](sim/AGENTS.md) |
| `protocol/` | API v1 schemas, OpenAPI, agent `SKILL.md` (also the onboarding for AI assistants). | [protocol/AGENTS.md](protocol/AGENTS.md) |
| `server/` | HTTP + WebSocket front door, persistence, sessions. Runs on Node and as the Cloudflare Worker behind terrakin.org. | [server/AGENTS.md](server/AGENTS.md) |
| `client/` | Mobile-first web client. Renders, never decides. | [client/AGENTS.md](client/AGENTS.md) |
| `docs/` | Vision, plans, architecture, handbook, RFCs, knowledge base. | [docs/AGENTS.md](docs/AGENTS.md) |
| `scripts/` | Repo tooling (`kb.ts`). Plain Node, no deps. | |
| `.claude/` | Shared Claude Code settings, skills, and subagents. | |

Dependencies point one way: `client -> protocol -> sim` and `server -> protocol -> sim`. `sim` depends on nothing.

## Commands

```sh
pnpm dev          # server :8787 + client :5173 (proxied), hot reload
pnpm verify       # lint + typecheck + test + kb:check + build. Same as CI.
pnpm test         # all tests; `pnpm vitest run --project sim` for one package
pnpm e2e          # Playwright smoke test on a phone viewport against the real build
pnpm format       # Biome: fix formatting and safe lint issues
pnpm kb           # rebuild the knowledge index
pnpm start        # production-style: build client, serve it from the server
pnpm cf:dev       # the Cloudflare Worker locally (same as terrakin.org)
pnpm cf:deploy    # deploy to terrakin.org (see docs/deploy.md)
```

## Definition of done

1. `pnpm verify` passes locally.
2. New behavior has tests at the lowest level that can catch the bug (sim rule -> sim test; wire format -> protocol test; routing/auth -> server test).
3. Docs that describe the changed behavior are updated in the same PR (folder `AGENTS.md`, `SKILL.md`, `docs/architecture.md`, `docs/plans/`).
4. Anything a future contributor would ask "why?" about has a decision record (`pnpm kb new decision "..."`).
5. If you're ending a session with anything in flight, you wrote a handoff (`pnpm kb new handoff "..."`).
6. The PR description says what changed, why, how it was tested, and discloses AI assistance.
