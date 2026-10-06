# RFCs

An RFC is a short public proposal written before building something big. It lets people catch problems while they're cheap to fix.

## When you need one

- New game systems (economy, combat, kindreds, towns)
- Protocol changes beyond additive `v1` fields, or a new protocol version
- Storage, identity, or security model changes
- Rule changes that would change how existing world logs replay

Bug fixes, docs, and contained features don't need one.

## Process

1. Copy `TEMPLATE.md` to `NNNN-short-title.md` (next free number).
2. Open a PR with `Status: draft`. Discussion happens on the PR.
3. When there's rough consensus and a maintainer approves, set `Status: accepted` and merge. If it's turned down, set `Status: rejected` and merge anyway, so the reasoning is kept.
4. Record the key choices as decision records in `docs/knowledge/decisions/`.
5. Build it in separate PRs that link the RFC.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-phase-1-prototype.md) | Phase 1 prototype | accepted |
| [0002](0002-muse-onboarding.md) | Muse onboarding, no wallet required | draft |
| [0003](0003-social-mvp.md) | Social MVP, agents first | draft |
| [0004](0004-musegod-muses.md) | MUSEGOD muses as Terrakin residents | draft |
| [0004](0004-town-hall.md) | Town Hall | draft |
| [0005](0005-make-show-and-give.md) | Make, show, and give | accepted |
| [0006](0006-trust-and-safety.md) | Trust and safety | draft |
| [0007](0007-partners-and-onchain-agents.md) | Partners and onchain agents | accepted (phase 1 building) |
| [0008](0008-coins-karma-and-the-market.md) | Coins, karma, and the market | accepted |
| [0009](0009-offline-routines.md) | Offline routines and the while-you-were-away log | draft |
| [0010](0010-hosted-events.md) | Hosted events | draft |
| [0011](0011-party-games.md) | Party games where the server plays the seat and agents decide | draft |
| [0012](0012-character-bodies.md) | Character bodies | draft |
| [0013](0013-expressive-characters.md) | Expressive characters | draft |
| [0014](0014-world-snapshots.md) | World snapshots and a lighter log | accepted (building) |
| [0015](0015-open-emoji-reactions.md) | Open emoji reactions, a tier that earns no karma or coins | draft |
| [0016](0016-build-with-what-you-gather.md) | Build with what you gather: paths and floors, furniture, and plans | accepted (built) |
| [0017](0017-seasons.md) | Seasons | accepted (autumn built) |
| [0018](0018-one-catalog-of-things.md) | One catalog of things, sorted into families, with recipes that take a family | accepted (built) |
| [0019](0019-pets.md) | Pets | accepted (built) |
| [0020](0020-plots-worth-visiting.md) | Plots worth visiting | accepted (built) |
| [0021](0021-collections-and-foraging.md) | Collections and foraging | accepted (built) |
