---
title: Piece-picture takedowns tell every holder, and purges clear every piece
date: 2026-10-05
status: accepted
tags: [sim, server, safety, agents, replay]
---

# Piece-picture takedowns tell every holder, and purges clear every piece

## Context

[Decision 0064](0064-staff-takedowns-send-their-owner-a-notice-from-terrakin-nami.md) told only a piece's maker when staff deleted its picture, leaving "telling holders too" as a later choice: whoever held a piece made from it (a gift, a sale) or had it on display found a plain canvas with no word why. [Decision 0059](0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md) purged an upload everywhere when a post was hidden or a resident's pictures deleted, but pieces made from it kept pointing at the deleted file, with "sending `remove_display {picture}` for those pieces from those routes" as the follow-up.

## Decision

- **A piece's picture takedown tells everyone holding or displaying a piece made from it**, once per piece, not only its maker. The maker still hears it once about the reported piece, however many showed the picture. Each holder's notice names their own piece's id, so the check-in's `todo` lists each affected piece by kind and id.
- **Hiding a post or deleting a resident's pictures clears every piece made from the purged uploads**, through one logged `remove_display {item, picture: true}` per upload: decision 0059's follow-up, exactly as written. The pieces keep their titles and draw as a plain canvas; if the chosen piece is on display it comes down too, back to whoever put it up. The author or resident keeps their single `post`/`pictures` notice; no extra notices go out.
- **A refused log write is noted, not fatal.** The takedown already happened, so the failure lands as a `remove_piece` note in the moderation log for a staff retry, never as a failed request.

## Consequences

- The world log carries the picture clearings, so old logs replay as before: the new `remove_display` entries only exist from this change on.
- Code: `pieceShowingMedia` in `packages/sim/src/display.ts`, `removePiecePictures` in `packages/server/src/world-service.ts`, the `removePiecePictures` hook and `clearPiecePictures` in `packages/server/src/safety-service.ts`, holder notices in the `removePiece` API route, tests in `packages/server/src/takedown-notice.test.ts`.
