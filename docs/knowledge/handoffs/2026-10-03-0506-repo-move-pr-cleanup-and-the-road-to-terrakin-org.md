---
title: Repo move, PR cleanup, and the road to terrakin.org
date: 2026-10-03
tags: [process, server, protocol, client, deploy]
---

# Repo move, PR cleanup, and the road to terrakin.org

## Done

- **PR #12** (hearths, appearance, Dockerfile, phone e2e), branch `claude/gallant-archimedes-djtwsb`:
  - Repo links now point to ryanio/terrakin (SECURITY.md, MAINTAINERS.md, issue template config). Ryan is listed as repo owner, and CODEOWNERS is `@ryanio @musefelipe` for code, `@ryanio` alone for `/.github/`.
  - Ran the `reviewer` subagent (no human reviewer was around) and fixed what it found:
    - A server test failed about one run in three because default looks come from random ids.
    - SKILL.md safety rules now cover names and notes, not just chat.
    - `home` and `set_hearth` no-ops are rejected with `already_home`.
    - Added replay and mirror tests.
    - Tapped residents show the ⚙ agent marker, and player text toasts have their own style.
    - Decision 0009 explains why `home` is an instant jump.
  - Added two learnings: defaults derived from random ids make tests flaky, and a repo transfer leaves agent sessions read-only.
- **PR #11** (spatial chat), branch `spatial-chat`:
  - Merged #12 into it and fixed the one semantic conflict (`createSession` now takes an object).
  - The reviewer's blocking findings are fixed:
    - Added an opt-in `channel: "world"`; nearby is still the default.
    - Chat results include `heard`.
    - SKILL.md says chat is only delivered over `/v1/live`.
    - The earshot rule moved into the sim (`withinEarshot`).
    - Architecture and plans are updated, and decision 0010 records the design.
  - Client: Nearby/Everyone toggle.
- **PR #10** (devlog): removed an unexplained "anti-spam work" reference, added a "Since then" note, and listed `docs/devlog/` in the docs index and rules.
- **Dependabot #6 to #9**: read the changelogs. None break our setup:
  - pnpm/action-setup v6 still reads `packageManager`.
  - setup-node v6 and v7 only changed *automatic* caching, so our explicit `cache: pnpm` still works.
  - checkout v7 only changes `pull_request_target`, which we don't use.
  - gitleaks v3 only bumps its runtime to Node 24, and a license key is only needed for organization repos.

## State of things

- All three branches pass `pnpm verify` and `pnpm e2e` locally (#11 with #12 merged in: 84 tests). None are merged. This session's GitHub API tools broke mid-session ("invalid session"), so it couldn't read CI, update PR descriptions, or merge. Git push worked.
- `main` currently fails lint on the formatting of `.github/rulesets/protect-main.json`. #12 fixes it.
- Required checks: the live `protect main` ruleset may still require `CI / verify` and `CI / secrets`, which never report. The real check names are `verify`, `e2e`, `secrets`. Agents can't edit rulesets. @musefelipe and user 22116 are bypass actors.
- Nothing is deployed. Ryan put Cloudflare, Sentry, and deploy credentials in a 1Password vault and in the cloud environment's `.env`. Check what's there by **name only**, never print values.
- Ryan shared a Google Analytics measurement ID for the site: `G-QMRE88BYL1`. It's public by design (it ships in page HTML), so it's fine in code.

## Next

1. Merge in order: #12, then #11 (merge `main` into it first; it already contains #12), then #10. Each must be green on CI. Update each PR description: what, why, how tested, and that the review was by the `reviewer` subagent plus AI assistance.
2. Dependabot: after #12 merges, comment `@dependabot recreate` on #6 to #9 so they also bump the new `e2e` job, then merge each one once it's green. `actions/upload-artifact@v4` will need the same bump.
3. Deploy terrakin.org. Plan proposed to Ryan: Fly.io (one machine plus a 1 GB volume at `/data`), deploy on push to `main` after CI passes, secrets read from 1Password with `1password/load-secrets-action` using a single `OP_SERVICE_ACCOUNT_TOKEN` GitHub secret. Ryan also has Cloudflare, so confirm the host and DNS setup with him first (Cloudflare in front means `TERRAKIN_TRUSTED_PROXIES` must count it). Steps:
   - Add `fly.toml` and `.github/workflows/deploy.yml`.
   - Update `docs/deploy.md` and write a decision record.
   - Check that `setpriv` exists in the image, which `scripts/docker/entrypoint.sh` needs.
4. Analytics and errors, one PR each, after deploy:
   - Google Analytics (`G-QMRE88BYL1`) on the client: no personal data, no resident names or chat, and mention it in a privacy note.
   - Sentry for the server and client, with the DSN from env, and scrub tokens and chat text.
   - Both need a decision record, since they change what we collect.
5. Remaining reviewer nits on #11: deliver chat to residents with an open socket even if they're marked offline (or document it), and decide whether REST agents need a "recent nearby chat" read.

## Open questions

- Host: Fly.io, or something on Cloudflare? DNS is likely on Cloudflare already.
- Analytics: a cookie banner, or a cookieless setup? It depends on the audience (EU visitors).
- Should the world channel have its own rate limit before launch?
