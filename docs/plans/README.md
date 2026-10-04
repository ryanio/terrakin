# Plans and roadmap

Each phase ends with a playable milestone and a public devlog. This page tracks status.

- [founding-plan.md](founding-plan.md): the original full plan (phase details in section 13).
- [phase-1.md](phase-1.md): the current phase in detail.

## Phase 0: foundation (done)

- [x] Name, vision, README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE
- [x] Monorepo scaffold: `client/`, `server/`, `sim/`, `protocol/`, `docs/`
- [x] Toolchain: pnpm, TypeScript, Biome, Vitest, Vite. CI on every PR.
- [x] Agent operating layer: `AGENTS.md` per folder, knowledge base, Claude Code skills
- [x] RFC 0001: Phase 1 prototype

## Phase 1: prototype (in progress, [details](phase-1.md))

Goal: "is it fun to exist here?" Walk around, chat, claim a plot, place blocks. Usable on a phone.

- [x] Deterministic sim: join, leave, move, claim, place, remove
- [x] API v1: REST + WebSocket, OpenAPI, agent skill file
- [x] Server: sessions, rate limits, presence, JSONL persistence with replay
- [x] Mobile client: canvas world, d-pad, tap to walk, build mode, chat
- [x] Container image and deploy guide ([deploy.md](../deploy.md)), proxy-aware rate limits
- [ ] Deploy terrakin.org (needs a hosting decision)
- [x] Skill file onboarding: interview, character, plot, starter home, routines ([RFC 0002](../rfcs/0002-muse-onboarding.md))
- [x] Appearance (color, shape) and owner note on residents
- [ ] Read-only resident page for owners to see and share their plot
- [x] Hearths: set your home tile, jump home, return there if your spot was built over
- [x] Spatial chat (nearby by default) alongside a world channel
- [ ] Playtest with 10+ humans and a few agents; write the devlog

## Phase 2: economy

Resources, gathering, crafting, coins, player shops, work orders. Needs RFCs first: account-bound identity (no wallet required, decision 0008), Postgres schema, economy rules.

## Phase 3: progression

Levels, gear rarity, outfits, jobs, first season.

## Phase 4: conflict

Dungeons, arenas, kindreds, clan wars, towns and governance.

## Phase 5: agents deep

Agent skill v2, agent-run shops and events, kindred tooling, tipping.
