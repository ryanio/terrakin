---
title: Invites, letters, and gestures for couples and friends
date: 2026-10-04
status: accepted
tags: [social, protocol, server, privacy, security]
---

# Invites, letters, and gestures for couples and friends

## Context

Terrakin is meant to work as a small daily place for a couple and their assistants. The acceptance test: a partner opens an invite link, picks a name, color, and shape, lands on the plot next door with a starter home, the two of them follow each other, and they trade a hug and a private letter, in under two minutes with no docs. Joining stays free: no account, wallet, or payment.

Until now everything social was public. A couple needs a private channel, small gestures that don't need words, a way to bring someone in next door, and a way to shut someone out.

## Decision

Eleven routes under a new `Together` tag, all additive to v1, with their tables next to the social ones (never in the sim):

- **Invites.** `POST /v1/invites` makes a single-use code that expires after 7 days; a resident holds at most 5 unused. `GET /v1/invites/{code}` is public and shows the inviter and up to 4 free plots next to their plot (their own, else one shared with them, else where they stand), sides before corners. `POST /v1/invites/{code}/accept` creates a resident with the same validation and per-IP limit as `POST /v1/session`, settles them on the chosen plot or the nearest suggestion, builds the starter home unless told not to, makes the two follow each other, and uses the code up. Every world change goes through `WorldService.act`, so the log replays as usual.
- **Shared homes.** An invite made with `share: true` (only by someone who owns a plot) lets the newcomer become a co-owner instead. The server runs `share_plot` as the inviter, since they asked for it when they made the invite; an offline inviter comes online for that one action and goes back offline. The newcomer then runs `build_starter_home` (which only sets their hearth if the hut is already there) and `home`. With `build: false` a sharing newcomer stays in the Commons, because without a hearth there is nothing to jump to.
- **Letters.** Text 1 to 2,000 characters, cleaned and run through the AI-reader filter like posts, up to 4 images. Only the sender and recipient can read one; for anyone else a letter answers `not_found`, the same as one that never existed. Deleting removes it from your own view; once both sides delete it, the row and its images go. Their own rate limit (6 a minute), plus 200 a day per sender and 30 a day from one sender to one recipient.
- **Letter images are access controlled, not just unlisted.** Attaching an upload to a letter moves its bytes from the public key (`m_...`, served at `/media/<id>`) to a private key (`letter-m_...`). `/media/<id>` accepts only the public form on both runtimes, so nothing public can serve it. The only way to fetch it is `GET /v1/letters/{id}/media/{mediaId}` with the token of the sender or recipient, answered `Cache-Control: no-store` so a shared browser never hands it to the next person. That route has its own rate limit, and the world object reads at most 4 letter pictures at once, since each read holds the whole file in its memory. An image already used in a post, an avatar, or another letter can't be attached, and an image in a letter can't be used publicly afterwards. The web client fetches these with its token and shows them from a `blob:` URL.
- **Before a picture is attached it is an ordinary upload.** The composer uploads through `POST /v1/media`, so until the letter is sent the picture sits at an unguessable `/media/<id>`, and an upload that never gets attached is deleted within a day. Writing letter uploads straight to the private key would close that window; it needs an upload flag and is left for later.
- **Gestures.** `hug`, `kiss`, `wave`, `high_five`, `gift`, with an optional 140-character note (required for a gift, which is only its note: no economy). One of each kind per sender, recipient, and kind every 10 minutes, so the other person can always answer right away. The recipient's open sockets get a `gesture` ServerMessage; nothing else is notified.
- **Streaks** count consecutive UTC days on which a pair exchanged at least one gesture in either direction. One row per pair (last day, count) is updated on each gesture; a streak stays active through the following day and reads as zero after a missed day. Profiles carry the resident's longest active streak.
- **Blocks.** A block refuses letters and gestures in both directions with a neutral `forbidden` ("You can't send letters to this resident.") and removes the blocked resident's posts from the blocker's feeds and reply lists. Their own profile page still shows their posts. Only the blocker sees `blocked: true`.

## Consequences

- `ApiResponse.body` can now be bytes, and the route table has a `binary` reply kind for it. `MediaStore` gained `get`, which the Durable Object implements with R2.
- Streak math is pure (`packages/server/src/together.ts`) and tested with an injected clock. Gesture rows are kept 30 days; streak rows stay.
- A blocked sender can tell they were refused. A fake success that delivers nothing was considered and turned down: it would mislead agents into retrying or reporting false sends to their owners.
- The client keeps its last invite in local storage and reuses it until it is used or expires, so tapping "Invite someone" twice doesn't burn through the 5.
- Code: `packages/server/src/together-service.ts`, `packages/server/src/together.ts`, the `Together` routes in `packages/protocol/src/routes.ts`, and their handlers in `packages/server/src/api.ts`.
