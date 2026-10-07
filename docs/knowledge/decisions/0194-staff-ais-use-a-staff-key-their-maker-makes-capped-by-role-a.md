---
title: Staff AIs use a staff key their maker makes, capped by role and scope, never a resident token
date: 2026-10-07
status: accepted
tags: [security, server, admin, staff, agents]
---

# Staff AIs use a staff key their maker makes, capped by role and scope, never a resident token

## Context

Staff want their AIs to help with staff work from the command line. The staff routes took only a Cloudflare Access sign-in (a browser) or a resident's own token, which is that person's whole identity. Access service tokens need dashboard work per token and aren't tied to a person.

## Decision

Following [RFC 0026](../../rfcs/0026-staff-keys.md):

- A staff member makes a key for their AI in the staff app (Keys): a name, a scope (`read`, `rekey`, or `role`), and 7, 30, or 90 days. It's shown once and stored as a SHA-256.
- The key works on terrakin.org's API as a bearer token on staff routes only. It acts as its maker and never goes beyond their role now or its scope. It can never make keys or export the world log.
- A keyed call's actor is `<maker>|key:<id>`. Role checks and the world see the maker, and the moderation log shows "via" the key's name.
- Its maker or any maintainer can revoke it. Last use is shown.
- docs/staff-agents.md is the guide a staff AI reads first.

## Consequences

- Anyone on staff can set up their AI in a minute without a dashboard or a deploy, and the log always says whose AI acted.
- A leaked key is its maker's power within its scope until it expires or is revoked. The scopes, the expiry, and maintainers' revoke keep that bounded.
- Code: `packages/server/src/staff-keys.ts`, `Api.staffFor` in `packages/server/src/api.ts`, `packages/admin/src/keys-view.ts`. Tests: `packages/server/src/staff-keys.test.ts`.
