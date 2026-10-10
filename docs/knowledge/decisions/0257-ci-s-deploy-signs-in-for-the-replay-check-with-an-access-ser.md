---
title: CI's deploy signs in for the replay check with an Access service token that reads the world log and nothing else
date: 2026-10-10
status: accepted
tags: [ci, deploy, security, staff]
---

# CI's deploy signs in for the replay check with an Access service token that reads the world log and nothing else

## Context

`pnpm cf:deploy` replays the live world's log under the sim being deployed and refuses on a mismatch ([RFC 0014](../../rfcs/0014-world-snapshots.md)). The log is read from `GET /v1/admin/world-log` on admin.terrakin.org, behind Cloudflare Access and for maintainers only. A laptop signs in as a person. CI had no sign-in, so nearly every deploy went out with the check skipped, and a sim change that replays old inputs differently would have been caught only by the World object's weekly replay, after it was live.

CI can't sign in as a person. A staff key ([RFC 0026](../../rfcs/0026-staff-keys.md)) is barred from the export on purpose, and it would act as its maker everywhere its scope reaches. The log holds everyone's chat and gift notes, so whatever CI holds should open that one read and nothing else.

## Decision

- CI signs in with a Cloudflare Access service token. Its id and secret are the GitHub Actions secrets `TERRAKIN_ACCESS_CLIENT_ID` and `TERRAKIN_ACCESS_CLIENT_SECRET`, which `scripts/replay-check.ts` sends as Access's two headers, and only to admin.terrakin.org. The Access application has a Service Auth policy for that token.
- Access signs a service token's request with a JWT that has no email and the token's client id as `common_name`. `AccessVerifier` takes it as the deploy check only when that id equals `TERRAKIN_ACCESS_DEPLOY_CLIENT`, a Worker var in `wrangler.jsonc`, and the rest is a service token's shape: `type` is `app`, `sub` is empty, and there is no email. A client certificate's sign-in also has a name and no email, so the name alone isn't enough. The id is not a secret. Any other service token is nobody, and so is every service token while the var is unset.
- The identity is held to one route in two places. `adminGate` in the Worker lets it through for a GET of `/v1/admin/world-log` and answers 403 for every page, file, and other path. `Api.staffFor` honors it only on an admin host, gives it the actor `service:deploy` for `getWorldLog`, and refuses every other staff route by name. The actor has no role, so a route's own maintainer check refuses it too; `getWorldLog` names it as the one exception.
- The Worker passes it to the World object in `STAFF_SERVICE_HEADER`, which `toWorld` drops from every incoming request, as it does the email header. The header's value is a fixed word, so a request that reached the World object without `toWorld` could claim it; `staff.test.ts` pins every way the Worker hands a request over, and the admin-host rule in `staffFor` means a slip on terrakin.org's own path still opens nothing.
- A check that can't run still doesn't hold a deploy back, as before. When CI had the token and the check couldn't run, `scripts/deploy.ts` writes `replay=skipped` to the job's outputs and the `smoke` job goes red, which opens the `deploy-smoke-red` issue ([decision 0250](0250-a-smoke-check-asks-the-live-worker-for-drawn-pictures-after-.md)). A check that ran and failed refuses the deploy.

## Consequences

- A GitHub secret can now read the whole log. It is used only by the deploy job on `main`. If it leaks, delete the service token in Cloudflare: nothing else depends on it, and deploys go on with the check reported as skipped until a new one is set.
- The token expires. When it does, deploys keep going and each one turns the smoke job red until a new token's secrets are set (and the var, if the id changed).
- Blocking the deploy when the check can't run was the other choice. It was left out because the first deploy that teaches the Worker to accept the token is checked against a Worker that doesn't yet, and because an expired token would stop every deploy, urgent fixes included.
- Code: `packages/server/src/access.ts`, `admin-host.ts`, `pages.ts`, `Api.staffFor` in `api.ts`, `getWorldLog` in `handlers/safety.ts`, `scripts/replay-check.ts`, `scripts/deploy.ts`, and the `deploy` and `smoke` jobs in `.github/workflows/ci.yml`. Tests: `access.test.ts` (which sign-ins count, and the gate), `staff.test.ts` (every other staff route refuses), `replay-check.test.ts`, `deploy.test.ts`.
