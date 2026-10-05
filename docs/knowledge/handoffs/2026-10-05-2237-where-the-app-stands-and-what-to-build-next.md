---
title: Where the app stands and what to build next
date: 2026-10-05
tags: [process, roadmap, deploy, e2e]
---

# Where the app stands and what to build next

## Start here

1. Read `AGENTS.md`, `docs/knowledge/INDEX.md`, this note, and [the one before it](2026-10-05-2142-market-moderation-bounties-pieces-and-galleries-3d-world-par.md), which lists what each of today's features does and Ryan's calls on them.
2. Work in a worktree with a branch name nobody else uses: `git worktree add -b <name> .claude/worktrees/<name> origin/main`, then `pnpm install --frozen-lockfile --offline`. Never edit the main checkout; other sessions use it.
3. Run e2e with your own port, `TERRAKIN_E2E_PORT=88x0 pnpm e2e`, so suites in different worktrees don't collide.
4. Before you push a decision record, check the highest number on `origin/main`. Parallel agents took the same number four times today.

## State of things

- Phases 1 and 2 of the roadmap are built: the world, the social MVP, the economy (coins, shop, karma, market, grants and bounties), make and give (items, gifts, pieces, display, galleries), the world in 3D, and partners phases 1 to 3. What's left unticked in `docs/plans/README.md` is the playtest, onboarding real agents, RFC 0003's formal acceptance, and partners phase 4 (waits for a partner that needs it).
- **Deploy is behind.** CI was red on e2e from `ab6a2c5` to `7bac79f`, so the live site is at `3d42b5a`. `63c4d43` fixes the last red spec (`world-3d.spec.ts` gets `test.slow()`). Its run deploys the promo removal, the 3D d-pad, owner-first gathering (a server-sent `own_plot_pickups` switches it on at boot), takedown notices, and Pillar praise. Check `gh run list --repo ryanio/terrakin --branch main` and that `GET /v1/world` has `plotPickupsOwned: true`.
- If `world-3d.spec.ts` still times out on CI, split it into two tests (tap-walk and d-pad; toggle, reload, and leave) rather than raising the timeout again. The 3D specs run alone at the end of the e2e chain, in software WebGL.
- CI cancels a run when a newer push lands, and a run whose commit was superseded deploys only when every newer commit is `[skip ci]` (`scripts/deploy.ts`). A burst of pushes deploys once, from the last real commit.
- Running five or more agents with e2e at once took the laptop's load past 100 and timed out the 3D specs. Three or four at a time is the limit.
- `.claude/worktrees/` holds about 30 worktrees from earlier sessions. Most are merged. Some may hold unpushed work.

## Next

Small, startable now, in order:

1. Confirm the `63c4d43` deploy, as above.
2. Clean up old worktrees: for each in `git worktree list`, if `git -C <path> log origin/main..HEAD` is empty and `git -C <path> status --short` is clean, `git worktree remove` it and delete its branch. Report any with unpushed work instead of removing them.
3. When staff delete a piece's picture, tell everyone holding or displaying a piece made from it, not only the maker (decision 0064 left this open). Clear piece pictures in the same purge when a post is hidden or a resident's pictures are deleted (decision 0059).
4. Tell an agent in its check-in when a taken-down lot went straight back to its things (decision 0056).
5. Build RFC 0008's 20-coin proposal deposit: held while the vote runs, refunded if the proposal reaches quorum, burned otherwise (RFC 0008's sinks table). It goes in the sim, and old logs must replay as before. The money guard ships with a test that shows it refusing.
6. Map Cloudflare Access emails to residents, so a maintainer can't confirm a town bounty or release a grant for their own household when signed in by email (decision 0062).
7. Partners: the RFC 0007 owner flair ("Keeper of …"), from the card's keeper.

Bigger, each needs an RFC or Ryan first:

8. RFCs 0009 (offline routines), 0010 (hosted events), 0011 (party games), and 0012 (character bodies) are drafts waiting on Ryan. Don't build them before he accepts one.
9. Phase 3, progression (levels, gear rarity, outfits, jobs, a first season), has no RFC yet. Drafting RFC 0013 with the `write-rfc` skill is a good next big step. Base it on karma tiers, the shop, and the market, which already exist.
10. The digital art gallery plan (`docs/plans/digital-art-gallery.md`) says it needs its own RFC before its phase 3.
11. Issue ryanio/terrakin#40 (welcome kits): gathering plus `give` may cover it, as Felipe said in ryanio/terrakin#42. Ask Ryan whether to close it or what's missing.
12. Issue ryanio/terrakin#23, the playtest and onboarding real agents, is Ryan's to run. Fixes from it come first when it happens.

## Open questions

- Ryan: who approves a new partner. Until he says otherwise it's him, and the bar is a takedown contact and an art license.
- Ryan: RFCs 0009 to 0012, and issue #40.
- Ryan: before anyone files a big grant, check the 1,000-coin grant cap against the live treasury.
