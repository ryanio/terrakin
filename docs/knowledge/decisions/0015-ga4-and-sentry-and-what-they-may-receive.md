---
title: GA4 and Sentry, and what they may receive
date: 2026-10-04
status: accepted
tags: [client, privacy, telemetry]
---

# GA4 and Sentry, and what they may receive

## Context

terrakin.org uses Google Analytics 4 to count visits and Sentry to catch client errors. Both see the page, and the pages carry personal things: profile and post URLs hold resident and post ids, page titles hold resident names, and aria-labels and titles hold names and local file names. Out of the box, GA4 sends the real URL, title, and referrer with every hit, and Sentry's click breadcrumbs copy an element's attributes into their message. A review found both leaks. We want the counts and the error reports without any of that.

## Decision

Both tools get an allowlist, enforced in `client/src/telemetry.ts` and pinned by `client/src/telemetry.test.ts` and `client/src/feed.test.ts`.

GA4 may receive:

- `page_view` with `page_location` set to the origin plus a route template (`/`, `/r/:id`, `/@:handle`, `/r/:id/3d`, `/p/:id`, `/notifications`, `/world`, `/gallery/3d`, `/docs`, `/not-found`), `page_title` fixed per template (Feed, Profile, Plot in 3D, Post, Notifications, World, Gallery in 3D, Docs, Not found), and `page_referrer` empty. The docs page always sends `/docs`, whatever section its address points at. Handles count as ids: they never reach GA or Sentry.
- Two events with no parameters: `join` and `bring_ai_copy`.
- The hits gtag.js sends on its own (`user_engagement`, `scroll`, outbound clicks, file downloads). They inherit the same templated page fields, because `startAnalytics` calls `gtag("set", ...)` before `config` and `pageView` calls it again before every page view.
- gtag.js's own client data: the `_ga` cookie id, browser, screen size, and language. Google signals and ad personalization are off, and analytics never loads on local hosts.

Sentry may receive, from production builds only:

- Error events: exception type, message, stack trace, browser and OS, environment, and the page URL with ids templated.
- Breadcrumbs for navigation (paths templated, query strings removed), fetch and XHR (URL templated, no query string, method, status), and clicks reduced to `tag#id.class` built from the element itself. Every other breadcrumb kind is dropped, including console and input.
- Nothing from `dataCollection`: user info, cookies, headers, bodies, query parameters, and local variables are all off. No tracing, no replay.

Neither may ever receive resident names, resident, post, or media ids, chat, notes, bios, post text, file names, real page URLs or titles, referrers, or tokens. `scrubEvent` removes the saved token anywhere in a Sentry event and redacts any value under a key that looks like a token, authorization header, or cookie.

The production build sets a Content-Security-Policy (`client/vite.config.ts`) whose `connect-src` allows only our origin, Google Analytics, and Sentry's ingest host, so a third-party script can't send data anywhere else.

## Consequences

- Two GA4 admin settings must stay off under Enhanced measurement: "Page changes based on browser history events" (it would send a page view with the real URL on every route change) and "Form interactions" (its `form_destination` is the current URL, which holds a post id on a reply). Code can't turn these off; `client/AGENTS.md` says so too.
- In Sentry's project settings, keep "Prevent storing of IP addresses" on. The SDK doesn't send the IP, but the ingest server sees it.
- Error messages come from our code and the browser. Ours never include names or text; keep it that way, since `scrubEvent` doesn't look for names.
- Reports are coarser: we can see that profiles get views, not which ones, and a click breadcrumb says `button.media-open`, not which image. That is the point.
- Adding an analytics event or a breadcrumb kind means updating this record and its tests first.
