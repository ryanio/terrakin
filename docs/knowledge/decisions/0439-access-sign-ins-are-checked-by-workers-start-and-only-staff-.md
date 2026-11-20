---
title: Access sign-ins are checked by workers-start, and only staff emails pass the admin gate
date: 2026-11-20
status: accepted
tags: [staff, access, security, dependencies]
---

# Access sign-ins are checked by workers-start, and only staff emails pass the admin gate

## Context

The admin host's gate (decision 0040) checked Cloudflare Access JWTs with its own verifier in `packages/server/src/access.ts`: key fetch and cache, RS256, audience, issuer, expiry, and the deploy check's service token (decision 0257). Other Workers on the same Access team need the same check, so it now lives in `workers-start/access`, a package with no runtime dependencies that the maintainer also publishes.

That package checks a sign-in against an allowlist as well: an email must be on the config's list, a service token's client id on its own. Terrakin's verifier let any signed-in email through the gate and left the role to `Api.staffRole`.

## Decision

`adminGate` calls `verifyAccessToken` from `workers-start/access` with a config built by `staffAccessConfig`: the maintainer and moderator emails (`TERRAKIN_MAINTAINER_EMAILS`, `TERRAKIN_MODERATOR_EMAILS`) as its emails and `TERRAKIN_ACCESS_DEPLOY_CLIENT` as its one service token, so an allowed service sign-in is the deploy check. A valid sign-in for anyone else is refused at the gate with 403 and `STAFF_ONLY`, and a failed key fetch is a 503. With a team and audience but nobody on either list the config is null, and the real admin host answers 503 as it does without Access. `Api.staffRole` still decides maintainer or moderator, and the `access` flag that stops resident tokens counting as staff still means only that the team and audience are set.

## Consequences

Terrakin keeps no JWT or key code of its own; fixes to the check land in the package. A signed-in non-staff person no longer gets the staff app's page, only a 403. Staff keys are unchanged: they are checked by `staffFor` on terrakin.org's API, which the gate never sees. Code: `packages/server/src/access.ts`, `packages/server/src/admin-host.ts`, `packages/server/cloudflare/worker.ts`. Tests: `packages/server/src/access.test.ts`.
