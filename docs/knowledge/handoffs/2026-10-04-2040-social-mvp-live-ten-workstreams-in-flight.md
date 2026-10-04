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

Also landed and deployed: owner-link (e59c573, decision 0031, option 2 revoke), social-2 (3db12d8, decision 0025; likes migrated to heart reactions, counts preserved), looks (5e0bfc9, decision 0029; homeModel is stored but the 3D view doesn't render it yet), town-hall (317e386, decisions 0026 and 0027), seo-og share cards (debc048, 0028, plus /town meta), townsfolk-art (6e484cb, refreshed on production with art version 2), and three-d (b60e618, 0030, with /r/:id/3d and /gallery/3d in matchPage). Social-2 was told to rebase onto b60e618 and land itself. Trust and safety (RFC 0006, decisions 0032 and 0033) is green on `wip/trust-safety` and is being rebased to cover handles and quote posts; land it next. Ryan's answers (2026-10-04): make T&S as automatic and agent-assisted as possible, Ryan reviews, admin lives at admin.terrakin.org, more moderators later (so the branch is adding Claude triage with a spend cap, the admin host, and a moderator role). Remaining open questions for Ryan: who is on call for self-harm and minors reports; whether suspension also hides the avatar in the world; whether reporters are told about outcomes; which PhotoDNA-class service for upload-time scanning and when; who registers the DMCA agent and whether to publish terms with a 13-and-up rule. Duo-social landed on main as 381352f..58f1d00 (decision 0024) and is deployed. The public agent changelog landed (7115b4d, decision 0036): CHANGELOG.md is published as /changelog, /changelog.md, /changelog.xml and GET /v1/changelog, and gen:check fails when the API changes without a new entry. Every notable push adds an entry. ANTHROPIC_API_KEY is set as a Worker secret (1Password item `anthropic`, field `credential_for_admin.terrakin.org`) for T&S triage; Cloudflare Access fronts admin.terrakin.org (team ryan-coral, policy: Ryan's two emails). Reserved decision numbers for the rest: social-2 0025, town-hall 0026 and 0027, seo-og 0028, looks 0029, three-d 0030, owner-link 0031 (renumber at landing). Most agents were stopped by the account session limit partway through their work. Their newest work may be uncommitted, in these local worktrees on Ryan's laptop. Check each with `git -C <path> status` and `git -C <path> log origin/main..`:

| Workstream | Worktree |
|---|---|

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

Updated 2026-10-04, late. The wip branches above have landed except trust and safety. In priority order:

1. **Land trust and safety** (RFC 0006 on `wip/trust-safety`, decisions 0032 and 0033). It gates the economy (karma penalties, farm detection) and the gallery (reports). Check first whether a session still holds the branch (`git log -1 origin/wip/trust-safety`).
2. **Economy, phase 1** ([RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md)): coins as a sim ledger with the supply identity, the treasury, the daily allowance, the welcome gift, `give_coins`, townsfolk daily budgets, the purse in the top bar, and coin notices. Write the month-long numbers simulation first. Ryan's answers are in the RFC's "Decided" section.
3. **Partners, phase 1** ([RFC 0007](../../rfcs/0007-partners-and-onchain-agents.md)): the chain reader, agent links, rechecks, the MUSEGOD partner with badge, border and flair, and `GET /v1/partners`. Confirm Adapter8004's agent-to-muse view against its verified source first. Closes issue #29. OpenSea may soon carry agent metadata on `agent_binding`; read through it when the card is fresh.
4. **The digital art gallery, phase 1** ([plan](../../plans/digital-art-gallery.md)): OpenSea username claims on trust, the X and bio checks, profile walls, the "hung a new piece" card. Ryan's asks to OpenSea are in `~/Desktop/opensea-asks-for-terrakin.md`; none block phase 1.
5. **RFC 0005 step 2:** seeds, growing on `new_day`, crafting, inventory, give. The economy's shop (phase 2) and market (phase 4) need its items.
6. **Draw with code** ([decision 0035](../decisions/0035-draw-with-code-first-and-rasterize-only-at-the-edge.md)): townsfolk postcards as posts drawn from data instead of PNGs. Also give the townsfolk handles so they have `/u/` links.
7. **Issues:** #20 (push new posts over the socket, so the home wall updates instantly instead of polling every 20 seconds), #31 to #37, #21 (CI deploy, needs Ryan's OK), #22, #27.

## Open questions

- Cloudflare CSAM Scanning Tool: enabled by Ryan on 2026-10-04 for the terrakin.org zone.

- **Cloudflare rules for agent paths:** removed on 2026-10-04 at Ryan's call, so the zone matches his other projects. If a 403 on `/skill.md` comes back, look at the real request in Workers Logs before adding rules.
- **Owner links:** Ryan chose option 2. Revoke only kills the agent's credentials, and recovery goes through a maintainer-issued re-key code. The owner-link agent is applying it (decision 0031) and lands itself after a reviewer pass.
- **GA admin settings:** done. Enhanced measurement's "page changes based on browser history events" and "Form interactions" are now off.
- **RFC 0004 and 0005 open questions:** ghost-block builds or instant builds, curated or free-form themes, recipe count.
- **Muse link and wallets:** answered in RFC 0007. Partners get cosmetics, exclusive items and promos, never an edge in play, and nothing requires a wallet.
