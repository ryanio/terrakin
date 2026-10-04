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
| [0005](0005-make-show-and-give.md) | Make, show, and give | draft |
| [0007](0007-partners-and-onchain-agents.md) | Partners and onchain agents | draft |
| [0008](0008-coins-karma-and-the-market.md) | Coins, karma, and the market | draft |
