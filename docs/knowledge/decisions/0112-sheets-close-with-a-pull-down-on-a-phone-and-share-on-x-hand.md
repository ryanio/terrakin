---
title: Sheets close with a pull down on a phone, and Share on X hands a picture to the share sheet
date: 2026-10-06
status: accepted
tags: [ui, client, mobile]
---

# Sheets close with a pull down on a phone, and Share on X hands a picture to the share sheet

## Context

The 3D view's photo was a panel built by hand: a card floating above the bottom of the screen, with a round close button laid over the photo's corner. It wasn't the shared `sheet`, so it looked and behaved unlike every other popup. The shared sheet itself only rose 24px with a fade on a phone, had no grab bar, couldn't be pulled down, and vanished without an animation when it closed.

People also wanted to share the photo on X. X's post link (`x.com/intent/post`) fills in text and a link, never a picture, and the photo exists only on the device as a blob.

## Decision

- Every sheet on a phone is a bottom sheet: flush with the bottom edge, a grab bar on top, sliding up as it opens and down as it closes. From 640px it stays a centered card. A pull down that starts while the card is scrolled to the top drags it; let go past a quarter of its height (at most 140px), or flick it, and it closes. Short of that it springs back. It also springs back when something is typed in one of its fields, the same guard a tap on the backdrop already had, so a pull never throws away words.
- The pull uses touch events and the `translate` property, so the closing animation (`transform`) carries on from where the finger let go, and a scroll, a sideways swipe, or a scrolled list inside the card is left alone.
- Closing any overlay drops its state at once (`onClosed` runs, the next overlay can open) and plays the dialog's `.closing` animation before it leaves the page. Leaving for another page skips the animation. A dialog with no closing animation, or reduced motion, goes at once.
- `dialog.sheet` is `overflow: clip`, never a scroll container, so focus landing in a card still below the edge can't scroll the dialog and make the sheet jump.
- `shareOnX` is a link to X's post box with the words and the page's link. With a picture, on a touch device that can share files, a tap hands the picture and the words to the share sheet instead, where X takes both. Anywhere else the link opens X and the picture is copied to the clipboard in the same tap, to paste into the post.

## Consequences

- Every sheet in both apps changed at once, and new sheets get all of it from `sheet()` in `ui/src/ui.ts`. A view never builds a `role="dialog"` panel or an X post link by hand; `client/src/shared-components.test.ts` fails on either.
- On a phone, Share on X opens the system share sheet, so the person taps X there. That is one more tap than a plain link, and the only way the photo reaches the post from the web.
- On a desktop the copy is silent until the toast, which the person may only see when they come back to the tab. The words and link reach X either way.
- Code: `teardown`, `playOut`, `sheet`, `pullToClose`, and `shareOnX` in `ui/src/ui.ts`; the sheet block in `ui/src/base.css`; `takePhoto` in `client/src/scene3d/page.ts`.
