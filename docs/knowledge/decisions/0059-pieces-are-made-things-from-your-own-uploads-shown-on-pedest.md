---
title: Pieces are made things from your own uploads, shown on pedestals and frames
date: 2026-10-05
status: accepted
tags: [sim, protocol, server, client, design, agents]
---

# Pieces are made things from your own uploads, shown on pedestals and frames

## Context

[RFC 0005](../../rfcs/0005-make-show-and-give.md) step 3 asks for `make_piece {media, title}` (an uploaded picture or `.glb` model turned into an item), `display {item, x, y}` on a `pedestal` or `frame`, and `take_down {x, y}`. It leaves open what a piece is in the item catalog, what can go on display, who may take a thing down and where it goes, whether a pedestal costs anything, and how an upload a piece shows is kept from the daily sweep of unused uploads. Items are live, so the town's daily buy rotation (`townBuys`, which reads `GOOD_KINDS.length`) and every recipe must replay as they did.

## Decision

- **A piece is a made thing of kind `piece`,** with the upload's id in `media`, `model: true` for a `.glb`, and its title in `label` (1 to 40 characters, filtered like a label). It's in `PIECE_KINDS`, next to `GOOD_KINDS` rather than in it, so the buy rotation and the recipes don't change. `MADE_KINDS` is both, and `give` and `list_item` by kind use it. Making one counts toward the 20 things you can make a day; no station is needed.
- **The server checks the upload and sets `model`.** It must be the actor's own PNG, JPEG, WebP, or `.glb` upload (`invalid_piece` otherwise). The sim checks only the id's shape, the title, and the caps.
- **A piece's upload is kept for good,** in a `piece_media` table the sweep skips, pinned when the piece is made and again for every piece in the world at boot. A letter can't take it private either.
- **Only made things go on display,** by id: goods and pieces, not seeds or produce. They have a maker to credit. Widening it later is additive.
- **`pedestal` is a new free block,** like a planter. `frame` (from the shop) works too. A pedestal or frame with something on it can't be removed.
- **A displayed thing still belongs to whoever put it up.** It leaves their things and lives in `items.displays`. `take_down` returns it to them, never to whoever tapped, and needs room in their things. They can take it down, and so can anyone who can build on that plot, so a co-owner can clear a shelf without keeping what's on it.
- **Display is public, labels and all.** `displayed` and `taken_down` go to everyone; `displayed` is marked untrusted when the thing has a label. The snapshot has `displays`.
- **Admire needs no reach.** `admire {x, y}` counts once a UTC day per resident per thing, never from its maker or whoever put it up, and adds to `admired` on the thing itself, so the count goes where it goes. Without a reach rule a gallery can be admired from a profile; requiring presence later would need a logged switch, since old admires would no longer replay.
- **Admiration feeds karma like reactions.** Each resident who admired something you made, on a day, counts once, weighted by their tier like a reaction ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). It goes to the maker, not whoever displayed it. The log holds the admires but not whose work each was, so the server records (admirer, maker, day) in an `admires` table as they happen (`WorldService.onAdmired`). Admiration earns no coins.
- **A gallery is a plot flag.** `set_gallery {px, py, open}` sets `gallery` on a plot, by its owner or anyone it's shared with (so a couple's shared home is one gallery). It lists what's on display there on `GET /v1/galleries`, `/galleries`, and the profiles of the plot's residents under "On display". A plot that isn't a gallery still shows its displays in the world. The flag needs no items and is absent until set; releasing the plot drops it. A suspended owner's gallery is left out, like their market stall. The heading is "On display" and the route `/v1/galleries`, so they don't meet the proposed digital art gallery's "Gallery" wall and `/v1/gallery/...` routes.
- **Staff can take a display down, and a piece's picture.** Residents report a thing on display (`display`) or a piece (`piece`), both by the made thing's id, from the pedestal's sheet or a gallery's list; the queue shows the picture and whose it is (who put it up for a display, the maker for a piece). Staff act with a server-only `remove_display {item, picture?}` from `TOWN_ACTOR`, logged without who did it, like `remove_listing`:
  - Without `picture`, the thing comes off display and goes back to whoever put it up, label and picture intact, with `display_removed` for everyone and their `inventory` event (`taken_down`). This is for a label.
  - With `picture` (a `piece` report), the piece's picture goes everywhere: the server deletes the upload through `purgeMedia` first (storage, then every post, look, avatar, and banner that uses it, and its `piece_media` pin), then the sim drops `media` and `model` from every piece made from that upload, wherever it is (things, displays, held aside, the market), with `picture_removed {items}`. The pieces keep their titles and draw as a plain canvas. If the reported piece is on display, it comes down too. If storage refuses, the world doesn't change and staff try again. A maker on the staff list is refused, as with deleting a resident's pictures.
  - Either action settles every open report on the thing, as a display and as a piece (and, for a picture, on every piece that showed it). A piece reported both ways counts once against karma, against its maker.
  - Nothing is destroyed or goes past `inventoryMax`. When whoever put it up has no room, it's held aside in `items.heldAside` and comes back (`held`) with their first input that leaves room: bookkeeping in `prepare()`'s commit, like the pantry. `GET /v1/inventory` shows it as `heldAside`, and the check-in says so. No coins move.
- **Pictures come from the existing art.** The map draws a piece's own picture in its frame (or a small framed canvas on a pedestal) and every other thing with its `itemArt` picture, through `itemArtImage`; lists and sheets use `thingPicture`.

## Consequences

- A label used to reach only whoever held the thing, and the market's listings. Now anything on display shows it in the world. Labels pass the `item_label` filter, and staff take down what slips through.
- Deleting a piece's picture is for a picture unfit anywhere, so it deletes the upload everywhere it's used, like hiding a post deletes its files. A takedown for a label or title alone ("Take off display", offered on a reported piece while it's up) leaves the picture.
- Hiding a post or deleting a resident's pictures purges an upload too, but pieces made from it keep pointing at the deleted file until a `piece` report removes their picture. Sending `remove_display {picture}` for those pieces from those routes is the follow-up.
- A taken-down display counts against karma like any upheld report: against whoever put it up for a `display`, and the maker for a `piece` (`reports.owner`).
- `take_down` waits for room in the things of whoever put it up, so a former co-owner who keeps their things full can hold a pedestal or frame on a plot (and so the plot) in place. If it happens, hold the thing aside for them the way the market holds a lot staff took down.
- A model piece on display draws as the piece picture on the 2D map, and in a frame in 3D. Both 3D views show displays (`client/src/scene3d/displays.ts`, within [decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)'s texture budget).
- An admire from before the `admires` table existed can't be counted; there were none. Code: `sim/src/display.ts` (`checkRemoveDisplay`, `returnHeldAside`), `removeDisplay` and `removePiece` in `server/src/api.ts`, `madeThingForReport` in `server/src/galleries.ts`, `recordAdmire` in `server/src/karma.ts`, `make_piece` in `server/src/world-service.ts`, `piece_media` in `server/src/social-service.ts`, `client/src/display-sheet.ts`, and the "Make a piece of art" card in `client/src/inventory-view.ts`.
