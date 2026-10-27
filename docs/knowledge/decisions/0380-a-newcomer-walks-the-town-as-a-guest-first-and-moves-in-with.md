---
title: A newcomer walks the town as a guest first and moves in with one name
date: 2026-10-27
status: accepted
tags: [client, onboarding, world]
---

# A newcomer walks the town as a guest first and moves in with one name

## Context

Getting into Terrakin asked a lot before anything was fun. The world's door was a card over a blurred town asking for a name, and a fresh join then opened four sheets in a row: the plot picker ([decision 0377](0377-a-person-who-joins-at-the-door-is-offered-a-plot-straight-aw.md)), the home designs, the plot's name with the first pantry and Plant a seed ([decision 0313](0313-the-sheet-after-a-home-plants-the-first-seed.md)), and the passkey offer ([decision 0378](0378-a-person-is-offered-a-passkey-on-the-way-in-and-at-milestone.md)). Ryan asked for fewer steps, and for people to be able to walk around before signing up, then sign up inside the world with fewer options and customize later.

## Decision

`/world` with no character opens straight into the live town as a guest: a figure labelled "You", in a look picked at random, at the spot where the server puts new residents (the sim's `spawnIn`), with the d-pad, taps to walk, the way back to the feed, and Move in in Claim plot's place. The guest exists on that screen only. It is put in the mirror so the map draws it, walked by the same walker with the sim's own `stepFrom`, and never sent. Nobody else sees it, nothing is stored, and the population counts leave it out. Its view of the town is the public snapshot, read again every 20 seconds, since a guest has no socket.

Move in brings up the same card the door used to be, now asking only for a name with one already suggested, so it is one tap. "Pick your look", signing in with a passkey and restoring with a key stay folded under it, and Keep looking around puts it away. On a plot `settle` would take, the button reads Live here, and that plot is settled right after the join with no picker. Anywhere else a join opens the picker as before.

After a home is built nothing else opens. The world's own notice says what the pantry brought, and the first seed and the plot's name are left to the next-step chip and Getting started. So a newcomer standing on a free plot goes name, home, passkey; one in the square goes name, picker, home, passkey.

## Consequences

- Nobody has to commit to anything to see the town move. A drive-by visitor makes no resident, so the counts on the front page and the pulse stay real people.
- The guest's walk is checked against the mirror only. A step the server would refuse for reasons the mirror can't see would go through for a guest. Since nothing is sent, that can't change the world, and what a resident does is still checked by the server.
- A guest who walked away from the square still joins at the server's spawn. With Live here the settle moves them back onto their plot at once; with Move in elsewhere the camera jumps to the square. Joining where the guest stands would need the join input to carry a tile, a sim and protocol change left for later.
- Planting the first seed is no longer offered in the sheet after a home (decision 0313). The chip still plants it in one tap, and `e2e/first-steps.spec.ts` covers that.
- Someone coming back on a browser that forgot them lands as a guest too. A small Sign in at the top right, where Invite goes once you live here, asks for a passkey at once; where that can't sign them in, the card comes up with the reason and "Restore with a key" open. The passkey request that puts a saved passkey among the name field's suggestions also stays open while they walk.
- A link into the world (`/world?at=`) still opens on the place with the card's "Step inside to go there". Done looking, the visitor walks the town as a guest from there.
- Code: `startGuest`, `guestStep`, `openMoveIn` and `livableHere` in `packages/client/src/world.ts`, the card in `packages/client/src/landing.ts` and `index.html`, the rule in `packages/client/src/claim-on-join.ts`, `.hud[data-guest]` in `world.css`, and `packages/client/src/home-sheet.ts`. `e2e/smoke.spec.ts` walks the guest round the Town Hall and onto a free plot, and `e2e/claim.spec.ts` moves in from the square.
