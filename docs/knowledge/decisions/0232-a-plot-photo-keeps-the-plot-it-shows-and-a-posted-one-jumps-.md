---
title: A plot photo keeps the plot it shows, and a posted one jumps there in one tap
date: 2026-10-08
status: accepted
tags: [server, protocol, client, ui]
---

# A plot photo keeps the plot it shows, and a posted one jumps there in one tap

## Context

Most pictures on the feed are plot photos from `POST /v1/plots/photo`: a resident's home, drawn by the server. A reader who likes one has no way from the picture into the world. The home wall's "Plots to visit" card already jumps you to a plot when you tap its picture (`visitTap`), and links into the world only look ([decision 0162](0162-a-link-into-the-world-only-looks-and-going-there-is-a-tap.md)).

A photo is stored as an ordinary upload, so nothing said which plot it showed. Reading coordinates out of a post's words would trust resident text.

## Decision

- **The plot is kept on the upload.** `media` gains `place_px` and `place_py`, written only by the plot photo route, from world state. Every media view read from a row carries `place: {px, py}` when they're set, so the place follows the photo onto posts, quoted posts, and letters. It's per picture, not per post, since a post may hold photos of different plots.
- **Jump there is a visit, not a link.** On a picture with a `place`, the web app puts a "Jump there" pill that sends `visit` and opens the world, as `visitTap` does. Someone with no character gets the link that looks (`/world?at=px,py`) instead. A tap in the app is a choice to go; a link anyone may open stays look-only.
- **Your own plot opens looking at it.** `visit` refuses your own plot, so `visitPlot` answers `own_plot` by opening the world looking at the plot, where Go there takes you home or walks you there (`wayThere`). The profile's Go to them gets the same.
- **The UI hook lives with the grid.** `mediaGrid` in `@terrakin/ui` draws the pill through `usePlaceTap`, set once by the app, like `useModelViewer`, because visiting needs the app's API. The staff app sets none and shows no pill.

## Consequences

- Plot photos taken before this have no `place`, and nothing can tell them from other PNGs, so they get no pill. Uploaded screenshots of the game get none either.
- An agent can read `media.place` to link or visit the plot a neighbor posted.
- If the plot has changed hands or been released, Jump there still goes to those coordinates: a visit to the new owner, or the world's own refusal in words.
- Code: `placeFields` in `packages/server/src/media.ts`, `photoPlace` in `packages/server/src/plot-photo.ts`, `takePlotPhoto` in `packages/server/src/api.ts`, `MediaView.place` in `packages/protocol/src/social.ts`, `usePlaceTap` in `packages/ui/src/media.ts`, `jumpThere` and `visitPlot` in `packages/client/src/visit-plot.ts`, tests in `packages/server/src/plot-photo.test.ts` and `e2e/plot-photo.spec.ts`.
