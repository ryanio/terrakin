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

Ten agent workstreams were still running when this session ended. Each was told to commit and push its work to `wip/<name>` on origin. Branches that never got pushed may still be in local worktrees under `.claude/worktrees/` on Ryan's laptop (`git worktree list`).

| wip branch | What | Spec |
|---|---|---|
| `wip/duo-social` | Letters (DMs), gestures (hug, kiss, wave, high five, gift) with streaks, invites with one-tap plot next to the inviter and optional shared home, blocks. Also: rotating join prompt with name and interest ideas, identity backup panel, shape and note pickers, logged-out profile "Join and follow", header "Bring your AI" button replaced by "Join" | musefelipe's acceptance test: an invite link to a home next door, mutual follow, a hug and a letter, all in under 2 minutes |
| `wip/agent-ready` | is-agentic.com fixes, no MCP: sitemap index plus live residents and posts sitemaps, robots.txt, RFC 9727 api-catalog, agent-skills index, Link headers, markdown twins and `Accept: text/markdown`, rate-limit headers, Idempotency-Key, WWW-Authenticate, JSON-LD, /about /privacy /contact, pricing.md, auth.md | Score was 71/100 before |
| `wip/town-hall` | RFC 0004: `new_day` and `close_proposal` logged inputs, proposals, votes, Commons builds, notice board, `/town` page, Town Hall building | RFC 0004 |
| `wip/social-2` | Handles (`/@handle`, issue #18), mentions, reactions (like maps to heart), reposts, quote posts, notifications | |
| `wip/seo-og` | satori and resvg-wasm share cards on the Worker (after musegod's `packages/cards`), per-page meta and JSON-LD through HTMLRewriter | |
| `wip/connect-x` | Verify an X handle by posting a phrase, checked through oEmbed (after Flock's `verify.ts`) | |
| `wip/owner-link` | A human claims their AI and an AI claims its human, by one-time codes, with badges both ways and owner revoke and re-key | Issue #19 |
| `wip/looks` | RFC 0005 step 1: themes, patterns, wear, custom pattern tile, `homeArt`, `homeModel` | Capri's lemon theme |
| `wip/three-d` | RFC 0005 steps A and B: three.js "Visit in 3D" for a plot, item templates (jam jar, painting, pedestal, lemon tree), residents' own `.glb` homes | |
| `wip/townsfolk-art` | A distinct building and avatar per townsfolk, plus `--refresh-art` to replace their posts on prod | |

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
   1. duo-social
   2. agent-ready
   3. social-2
   4. owner-link
   5. connect-x
   6. seo-og
   7. town-hall
   8. looks
   9. three-d
   10. townsfolk-art

   After townsfolk-art, run `pnpm townsfolk -- --base https://terrakin.org --refresh-art` (see `scripts/townsfolk/README.md`).
2. Re-scan https://is-agentic.com/scan/terrakin.org after agent-ready lands.
3. RFC 0005 step 2: seeds, planters, growth on `new_day` (needs Town Hall's day counter), kitchen and crafting (lemon jam), inventory, give. Then pieces, galleries and admire. Then the 3D world view (step C).
4. Issues #31 to #37 from the musebook and freebots research: heartbeat, offline routines, hosted events, plot photos, did_you_mean, praise, party games.
5. Add a CI deploy job (issue #21). It needs Ryan's OK, because it wires the Cloudflare secret into CI.
6. Error tracking for the Worker (issue #22). It needs a server DSN for a separate Sentry project.
7. Strip video and model metadata (issue #27).
8. Muse badge (issue #29), once musegod publishes the link.

## Open questions

- **Cloudflare rule for agent paths.** Should we add a Cloudflare configuration rule that turns off the security-level challenge and Browser Integrity Check for `/skill.md`, `/skill`, `/llms.txt`, `/v1/*` and `/media/*`? musefelipe saw a 403 fetching the skill from a chat client's page reader. Every user agent gets 200 from a normal IP, so a data-center IP challenge is the likely cause. This changes zone security settings, so it needs Ryan's yes.
- **GA admin settings.** In the GA property, Enhanced measurement's "page changes based on browser history events" and "Form interactions" must be off (decision 0015). Only Ryan can check that.
- **RFC 0004 and 0005 open questions:** ghost-block builds or instant builds, curated or free-form themes, recipe count.
- **Muse link and wallets.** Should a verified Muse (musegod) ever get anything beyond a badge? Decision 0008 says nothing in play may require a wallet.
