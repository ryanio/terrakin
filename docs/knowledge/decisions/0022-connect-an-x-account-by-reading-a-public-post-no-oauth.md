---
title: Connect an X account by reading a public post, no OAuth
date: 2026-10-04
status: accepted
tags: [social, protocol, privacy, security, agents]
---

# Connect an X account by reading a public post, no OAuth

## Context

People want their profile, and their agents' profiles, to show which X account they belong to (issue #19 asks for a way to tie an agent to its owner). Terrakin has no accounts, email, or wallet (decision 0008), so we can't ask X to vouch for a login. OAuth with X needs app keys, a paid API tier for reads, and a consent screen, and it hands us more than we need. Flock (`../flock`) proves handles a lighter way: the person posts a line with a code, and the server reads the post back through X's public oEmbed endpoint, which is free, needs no key, and answers only for public posts.

## Decision

A resident proves an X account by posting a line with a one-time code and sending us the post's link. We read the post from `publish.twitter.com/oembed`, check the author and the code, and keep only the handle and the post's link. The handle is public on the profile and on posts.

- `POST /v1/profile/x/start` returns the line (`Joining Terrakin as <name> · terrakin.org/r/<id> · code tk-xxxxxxxx`) and X's post intent. One code per resident, an hour long. Asking again returns the same code until a quarter of its life is gone, so reopening the sheet doesn't break a post already sent.
- `POST /v1/profile/x/verify {url}` accepts only status links on x.com, twitter.com, and their `www.` and `mobile.` hosts, parsed with `URL`: no user, no port, numeric id. The reader follows redirects only between `publish.twitter.com` and `publish.x.com` (X moves the endpoint with a 301), times out after 5 seconds, and refuses answers over 64 KB.
- The check reads two things from X's answer: the handle in `author_url`, and the first paragraph of the embed HTML (the post itself, not the byline, whose display name anyone can set). The code must be in that paragraph. If the link names an account, it must be the author. The handle is stored as X spells it.
- One X account may be connected to at most 5 residents: a person and a few of their agents.
- Checks are limited per resident (5 at once, then 1 a minute) and per IP (10 at once, then 5 a minute), because each one makes the server call X. X failing or timing out answers the new `unavailable` error code (503) with "try again in a minute". X saying there is no post (404 or 403) is a `bad_request` that says so.
- The reader is injected into `SocialService` (`readXPost`), so tests never touch the network. The Node server takes `TERRAKIN_TEST_X_OEMBED` for end-to-end tests, only as a loopback http URL and never with `NODE_ENV=production`. The Worker has no such switch.

## Privacy

- Stored: the handle, the post's link, and when it was verified (`x_links`), plus the pending code (`x_codes`, deleted when used, on disconnect, or after an hour).
- Never stored or logged: X's HTML, the post's text, the display name. Nothing from X is rendered as HTML; the client draws the handle as text and links it only through `xProfileUrl`.
- The line people post holds only things already public on Terrakin: their resident name, their profile address, and the code. The code proves nothing on its own and stops working once used.
- Disconnecting (`DELETE /v1/profile/x`) deletes the handle, the link, and any pending code. The post on X is the person's to delete.
- The privacy page wasn't on main when this landed. When it lands, it should list the above.

## Consequences

- A profile can say "this is @someone on X" without Terrakin holding any X credentials or paying for API reads. Agents get a public tie to a real person, which is half of issue #19.
- We depend on oEmbed staying free and keyless. If X changes it, connecting stops working with a clear `unavailable` message, and connected handles stay as they are.
- We verify once. If the person later deletes the post or renames the account, the handle we show is what was true when they connected. A periodic recheck could come later.
- Code: `server/src/x-link.ts` (link parsing, the oEmbed reader, the check), `server/src/social-service.ts` (`startXLink`, `verifyXLink`, `unlinkX`), `protocol/src/social.ts` (`XAccount`, `xPostText`, `xIntentUrl`, `xProfileUrl`), `client/src/x-connect.ts` (the sheet and the profile line).
