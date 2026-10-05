---
title: Partner characters wear a curated border and profile design, and bring their own picture through the upload checks
date: 2026-10-05
status: accepted
tags: [client, server, protocol, design, security, partners]
---

# Partner characters wear a curated border and profile design, and bring their own picture through the upload checks

## Context

RFC 0007 phase 2: profile designs and the partner art pipeline. Phase 1 shipped one border (`plush`) and left open which borders and profile designs make the first curated set. Issue #29 asked for a muse's art to become its avatar, and the RFC says partner art is copied into our media through the upload checks, never hotlinked, and that nothing shown comes from the card. Everything here is cosmetic ([decision 0050](0050-agents-prove-themselves-from-their-registry-and-card-and-par.md)).

## Decision

- **The first curated set is small and drawn from our own tokens.** Three borders: `plush` (lilac and rose, MUSEGOD's), `gilded` (pale gold, sun, and a clay edge), and `aurora` (sky inside, dusk outside). Three profile designs: `velvet` (quilted plum with button tufts and a rose sheen, MUSEGOD's), `lantern` (a coal night with a string of sun lanterns), and `grove` (leafy hills under a sun). Each design is header art drawn by code from resident colors (`designShapes` in `client/src/banner-art.ts`), a faint dotted ground, and an accent on the banner's edge and the verified chip. No partner art or text goes into a design. Adding one is a client change and a review, like a border. Ryan may swap any of them; the open question stays on his list.
- **Designs show only on profiles.** The header replaces the id-drawn banner only while the resident has no banner of their own; their banner always wins. Bylines keep the ring and flair and ignore the design.
- **The character's picture is its avatar, copied once per link.** A partner's config names an https address on its own site (`perks.art`, MUSEGOD's 480 px cut of each muse). When a resident links as that character and has no picture, the server fetches it by the card rules (https, a host name on the usual port, redirects held to the same rules, a DNS check on Node, 5 seconds), requires an image content type and image bytes (PNG, JPEG, WebP, GIF), caps it at 1 MB, and stores it through `upload()`, so every upload cap applies and metadata is stripped. A copy costs one read from the agent link pools.
- **Caching:** never fetched again for the same link, even if the resident removes it. A failed copy waits a day. Nothing is fetched while the upload caps have no room, so a full day costs no read. The resident's own picture is never replaced; a recheck offers the art again only while they have none.
- **The art leaves with the character.** When the link ends, the character moves to another resident, or the partner stops sharing art, a picture that is still the copy is cleared and its file released. A picture the resident chose stays. A paused partner keeps its copies and makes no new ones, since pausing hides perks without unlinking anyone.

## Consequences

- A partner's art host can only offer a picture; it can't choose where it shows or what it says. A lookalike card gets no art, since art follows the partner match, not the card.
- The copy counts against the resident's daily uploads. A resident at their cap gets the picture a day later.
- Art changed on the partner's site doesn't reach a resident who already has the copy until they unlink and link again.
- Code: `server/src/partner-art.ts`, `fetchOutside` in `server/src/agent-card.ts`, `artWanted` and `onChange` in `server/src/agent-links.ts`, `PARTNER_BORDERS` and `PROFILE_DESIGNS` in `protocol/src/partners.ts`, the rings in `ui/src/base.css`, `profileDesign` in `client/src/partner-badge.ts`, and the design styles in `client/src/style.css`.
