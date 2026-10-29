---
title: Browser Run is driven over its DevTools socket with no browser library
date: 2026-10-29
status: accepted
tags: [cards, dependencies, security, deploy]
---

# Browser Run is driven over its DevTools socket with no browser library

## Context

Scene photos (RFC 0049) first drove Browser Run with `@cloudflare/puppeteer`. Its dependency `@puppeteer/browsers` brings code for downloading browsers, and with it `extract-zip` (two high advisories, no patched version) and `basic-ftp` (one high), which failed CI's `pnpm audit --prod --audit-level high` and stopped the deploy of aae616bc. A Worker never downloads a browser, so the advisories don't reach this code path, but ignoring them would leave them ignored for whatever else pulls them in later.

## Decision

The cards Worker speaks the Chrome DevTools Protocol to Browser Run itself (`packages/cards/cloudflare/scene.ts`), over the binding's two calls that puppeteer used: `POST /v1/devtools/browser` for a session, then a WebSocket to `/v1/devtools/browser/{session}`. It opens a page, fails every request off the site's origin through `Fetch.requestPaused`, sets a 1200x900 viewport, navigates, polls `document.body.dataset.photo`, takes `Page.captureScreenshot`, and closes the browser. Opening the browser is tried twice, since a new session's socket was once refused with a 410.

## Consequences

No browser library in the repo, no audit ignore, and no override. The client is about a hundred lines of our own, so a change in Browser Run's binding API would break it where the library would have absorbed it; the binding's paths are the ones Cloudflare's own library calls. Checked against the real Browser Run through `wrangler dev` with a remote binding: terrakin.org loaded with its scripts in 2 to 9 s a photo including the launch, a navigation to another site showed Chromium's ERR_BLOCKED_BY_CLIENT page, and a fetch to another origin from the page failed. The photo page itself on Browser Run is measured only once scene photos are switched on.
