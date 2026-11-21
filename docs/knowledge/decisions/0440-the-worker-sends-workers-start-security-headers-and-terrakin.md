---
title: The Worker sends workers-start security headers, and Terrakin keeps its own CSPs and stream caps
date: 2026-11-20
status: accepted
tags: [security, server, dependencies]
---

# The Worker sends workers-start security headers, and Terrakin keeps its own CSPs and stream caps

## Context

`workers-start` 0.14.0 added modules for request bodies (`workers-start/body`), CORS (`workers-start/cors`), security headers and CSPs (`workers-start/security`), and outbound HTTP (`workers-start/http`). Terrakin already had its own code for most of this, often stricter, and the public site sent no HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` or `Cross-Origin-Opener-Policy` at all. Each module was adopted only where it is at least as strict as what it replaces.

## Decision

Every answer the Worker sends goes through `withSiteSecurity` (`pages.ts`), which adds the package's default headers: two years of HSTS with `includeSubDomains` and no preload (every terrakin.org host the Worker serves is a custom domain on HTTPS), `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, camera, microphone, location, payment and USB off, and `Cross-Origin-Opener-Policy: same-origin` (the site opens no popup that needs its opener). A header the answer set itself wins, so `ADMIN_PAGE_HEADERS` and `mediaHeaders` keep their CSPs and `no-referrer`. A socket upgrade passes untouched. The public pages' CSPs stay the meta tags the client build writes, with script hashes the package's builder has no way to compute.

The Worker's JSON body reader is the package's `readJson` (`readJsonBody` in `media.ts`), which keeps the same streaming cap and adds a `Content-Length` refusal before reading and a fatal UTF-8 decode, matched on Node. It doesn't require a JSON content type, so both adapters accept the same bodies. `readCapped` stays: it reads response streams (agent cards, chain RPC answers) and uploads, and the package reads only a `Request`.

The place file's `*` CORS goes through `cors()`, which also answers its preflight. The API gets no CORS headers: it is same-origin, and staff routes refuse other origins.

Outbound calls stay on their own code. Every one already has a timeout, the ones that read untrusted answers cap the bytes they read, and the ones that spend (triage, chatter) must not retry. `fetchJson` retries by default and has no response byte cap.

## Consequences

A browser that has seen terrakin.org once refuses plain HTTP to it and its subdomains for two years, so a new subdomain must serve HTTPS from the start. Framing any Terrakin page is refused. Fixes to the shared modules land in the package. Code: `packages/server/src/pages.ts`, `packages/server/src/media.ts`, `packages/server/cloudflare/worker.ts`. Tests: `packages/server/src/pages.test.ts`, `packages/server/src/social.test.ts`.
