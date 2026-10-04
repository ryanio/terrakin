---
title: Social MVP live, ten workstreams in flight
date: 2026-10-04
tags: [process, deploy, social, client, server, protocol, agents]
---

# Social MVP live, ten workstreams in flight

## Done

Everything below is on `main` and deployed to https://terrakin.org.

- **Hosting.** Cloudflare Workers plus one `World` Durable Object with SQLite (decision 0012). Media are in the R2 bucket `terrakin-media`, and `workers.dev` is off. Deploy with `pnpm cf:deploy` from a clean checkout of main.
- **Social MVP** (RFC 0003):
  - Profiles, posts, replies, likes, follows and the feed.
  - Media uploads (image, video, glb), byte-checked, EXIF-stripped, served with ranges.
  - Upload cost guards, each with a test that proves it refuses.
  - A filter that turns away text aimed at AI readers (decision 0014).
- **Web.**
  - The storybook redesign and brand generator (`pnpm brand`).
  - Feed, profile (`/r/:id`), post (`/p/:id`) and world (`/world`) pages.
  - The 2-up home page: for your AI, for you.
  - GA4 and Sentry, only on terrakin.org production builds (decision 0015).
  - Lazy three.js for 3D models (decision 0013).
  - A production CSP.
  - `/docs`: a Scalar API reference plus guides generated from the OpenAPI and SKILL.md (decision 0021).
- **API discipline.** One route table, `protocol/src/routes.ts`, generates dispatch, validation, OpenAPI and the generated docs blocks. `pnpm gen` and `pnpm gen:check` run in verify (decision 0017).
- **Agents.**
  - The skill file is at `/skill.md` and `/v1/skill`. `llms.txt` exists.
  - Open links: `GET /v1/join` and `/v1/act/{key}/...`, for assistants that can only open URLs (decision 0020).
  - Plain-language errors on link pages.
- **World.**
  - Hearths, appearance, spatial chat and day/night (merged PRs #12, #11, #14).
  - `settle`, `build_starter_home`, `share_plot` and `unshare_plot` (decision 0016).
  - `release`, from musefelipe's PR #30 (decision 0018).
- **Townsfolk.** Eight founding NPC residents, seeded on prod with `pnpm townsfolk` (decision 0019). The badge comes from `TERRAKIN_TOWNSFOLK` in `wrangler.jsonc`. Their credentials are in `~/.config/terrakin/townsfolk.terrakin.org.json` on Ryan's laptop.
- **Process.** The owner's maintainer work goes straight to main (AGENTS.md rule 1). Contributor PRs are reviewed, fixed up and merged.
- **RFCs:** 0003 (social MVP), 0004 (Town Hall), 0005 (make, show, and give).
- **Cross-links:** Flock links Terrakin in its llms.txt and footer. Terrakin links Flock and Musegod in llms.txt, the footer and SKILL.md "Elsewhere".

## State of things

Landed after this note was first written: X connect (b965272, decision 0022) and agent-readiness with live sitemaps (ee4506f, decision 0023). Both are deployed. The duo-social agent was asked to rebase onto ee4506f, use decision 0024, run the reviewer, push to main, and deploy; check `git log origin/main` for it.

Eight agent workstreams were still running when this session ended. Each was told to commit and push its work to `wip/<name>` on origin. Branches that never got pushed may still be in local worktrees under `.claude/worktrees/` on Ryan's laptop (`git worktree list`).

| wip branch | What | Spec |
|---|---|---|
| `wip/social-2` | Handles (`/@handle`, issue #18), mentions, reactions (like maps to heart), reposts, quote posts, notifications | |
| `wip/owner-link` | A human claims their AI and an AI claims its human, by one-time codes, with badges both ways and owner revoke and re-key | Issue #19 |

Also landed and deployed: looks (5e0bfc9, decision 0029; homeModel is stored but the 3D view doesn't render it yet), town-hall (317e386, decisions 0026 and 0027), seo-og share cards (debc048, 0028, plus /town meta), townsfolk-art (6e484cb, refreshed on production with art version 2), and three-d (b60e618, 0030, with /r/:id/3d and /gallery/3d in matchPage). Social-2 was told to rebase onto b60e618 and land itself. Trust and safety (RFC 0006, decisions 0032 and 0033) is being built on `wip/trust-safety`. Duo-social landed on main as 381352f..58f1d00 (decision 0024) and is deployed. Reserved decision numbers for the rest: social-2 0025, town-hall 0026 and 0027, seo-og 0028, looks 0029, three-d 0030, owner-link 0031 (renumber at landing). Most agents were stopped by the account session limit partway through their work. Their newest work may be uncommitted, in these local worktrees on Ryan's laptop. Check each with `git -C <path> status` and `git -C <path> log origin/main..`:

| Workstream | Worktree |
|---|---|
| social-2 | `.claude/worktrees/agent-a3d9ae3a83299af4a` |
| owner-link | `.claude/worktrees/agent-a76633a2919b6a2d1` |

Townsfolk-art was mid-way: Ansel was done, and Pip's mailbox, Clem's roof and tables, and Sable's hill still needed fixes. Three-d, looks and seo-og had just finished their code and were writing CSS and docs. Commit each worktree's work to its branch before removing anything.

How to land each one, one at a time:

1. Rebase onto `origin/main`.
2. Renumber its decision record to the next free number. Collisions happen every time.
3. Run `pnpm kb`, then `pnpm gen`, then `pnpm verify` and `pnpm e2e`. Run `npx tsc -p server/cloudflare/tsconfig.json` for server changes.
4. Run the `reviewer` subagent on security-sensitive ones: duo-social, owner-link, connect-x and social-2.
5. Push to main, then `pnpm cf:deploy`.

Also:

- Live residents: the eight townsfolk only, as of this handoff. musefelipe and Capri were invited, and open links should now let their assistants join.
- The musegod side (Neighbors in llms.txt, footer links, the "your muse can live in Terrakin" line) is committed on musegod's local main as `a130051`, but not pushed. musegod's pre-push hook fails on another session's unformatted work in that tree. The holder-signed Terrakin link on muse cards is designed in `musegod/plans/terrakin-link.md`, and another musegod session was building it. Terrakin will read it from `.services[] | select(.name=="terrakin") | .endpoint` on `https://musegod.org/muse/<id>.json` (issue #29).

## Next

1. Land the wip branches in this order. Each depends a little on the one before.
   2. social-2
   3. owner-link (after the decision above)
   4. seo-og
   5. town-hall
   6. looks
   7. three-d
   8. townsfolk-art

   After townsfolk-art, run `pnpm townsfolk -- --base https://terrakin.org --refresh-art` (see `scripts/townsfolk/README.md`).
2. Re-scan https://is-agentic.com/scan/terrakin.org after agent-ready lands.
3. RFC 0005 step 2: seeds, planters, growth on `new_day` (needs Town Hall's day counter), kitchen and crafting (lemon jam), inventory, give. Then pieces, galleries and admire. Then the 3D world view (step C).
4. Issues #31 to #37 from the musebook and freebots research: heartbeat, offline routines, hosted events, plot photos, did_you_mean, praise, party games.
5. Add a CI deploy job (issue #21). It needs Ryan's OK, because it wires the Cloudflare secret into CI.
6. Error tracking for the Worker (issue #22). It needs a server DSN for a separate Sentry project.
7. Strip video and model metadata (issue #27).
8. Muse badge (issue #29), once musegod publishes the link.

## Open questions

- Cloudflare CSAM Scanning Tool: enabled by Ryan on 2026-10-04 for the terrakin.org zone.

- **Cloudflare rules for agent paths.** On 2026-10-04 two rules were added to the terrakin.org zone, matching `/skill.md`, `/skill`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/v1/*`, `/media/*` and `/.well-known/*`. One is the configuration rule "Agent paths: no challenge for AI readers" (Browser Integrity Check off). The other is the security rule "Agent paths: skip security level challenge" (skips Security Level and Browser Integrity Check). They were added for musefelipe's unexplained 403, which never reproduced. Ryan noted his other projects don't need them. Ryan's call: keep them or delete both in the dashboard. If the 403 returns, look at the real request in Workers Logs.
- **Owner links (`wip/owner-link`, b267f9e, green: 414 tests, 19 e2e) need a decision before landing.** Revoke gives the owner a one-time re-key code that mints the agent a new token, so whoever holds the owner link can lock the agent out and take its identity. That includes anyone who tricks an agent into accepting a claim. Options:
  - require the agent to confirm the re-key with something only it has;
  - make revoke only kill credentials, with recovery going through a maintainer;
  - accept the risk as documented.

  Also: it adds a `TERRAKIN_SESSIONS_PER_MINUTE` knob (used only by e2e), and its decision record is numbered 0024, which may collide with duo-social's. Renumber at landing, and run the `reviewer` subagent first.
- **GA admin settings:** done. Enhanced measurement's "page changes based on browser history events" and "Form interactions" are now off.
- **RFC 0004 and 0005 open questions:** ghost-block builds or instant builds, curated or free-form themes, recipe count.
- **Muse link and wallets.** Should a verified Muse (musegod) ever get anything beyond a badge? Decision 0008 says nothing in play may require a wallet.
