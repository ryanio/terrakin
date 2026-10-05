# RFC 0012: Character bodies

- Author: drafted by Claude for Ryan
- Date: 2026-10-05
- Status: draft
- Discussion: <PR link>

## Summary

Add `body` to the partner perk kinds in [RFC 0007](0007-partners-and-onchain-agents.md): a resident verified as a partner character is drawn in the 3D scenes as that character's own rigged 3D figure instead of the peg figure. MUSEGOD is the first partner to supply one. It is making an official rigged model for each of its 999 characters (`plans/muse-3d.md` in ryanio/musegod), all to one convention, so Terrakin needs one loader for all of them. A body is cosmetic, bound to the link, and gone on unlink, like a border.

## Motivation

- **Agents and their owners:** RFC 0007 makes "Verified Muse #464" a badge and a border. In the town and on the plot it is still a peg in the nearest of eight colors. Seeing the character itself standing at its hearth is what makes moving in feel real.
- **Homesteaders and hosts:** a few recognizable characters walking around a plot make the world look lived in, which is what a new map lacks.
- **Everyone, later:** the loader and its conventions don't care where a body comes from. Once it works for partner files, the same path can take a resident's own uploaded body (`.glb` uploads already exist for home models), behind the review queue. That's a separate RFC, but this one is built so it's a small step.

## Design

### What a partner supplies

A body file per character, following a convention the partner publishes and we check:

- One self-contained `.glb`: no external buffers or textures. Meshopt compression and WebP textures allowed.
- At most 300 KB, 4k triangles and one 512 px texture. That's MUSEGOD's `lo` size.
- Meters, feet on y = 0, centered, facing +z. The height is in the partner's manifest.
- A skeleton with an `idle` clip, and optionally `walk`, `wave`, `sit`.
- Named empty nodes for attaching wear: `socket_head`, `socket_face`, `socket_neck`, `socket_back`, `socket_hand_l`, `socket_hand_r`, `socket_halo`, `socket_feet`.

Partner config gains a URL template for the body (MUSEGOD: `https://musegod.org/muse/3d/body/lo/<subject>.glb`) and the manifest that lists hashes and heights.

### What the server does

When a link with a `body` perk is made, or the manifest's hash for that subject changes, the server fetches the file from the partner's allowlisted host, checks it against the caps above (glTF validation, no external URIs, triangle and texture limits, size), strips extras, and stores it in Terrakin media like any upload. The link row gets `bodyMedia` and `bodyHeight`. Hotlinking is never used, same as the art in [RFC 0004](0004-musegod-muses.md). On unlink or a failed recheck, the row's body goes with the badge.

The resident view gains one optional field, set only by the server:

```json
"body": {"url": "/media/m_...", "height": 0.3}
```

### What the client does

- In `scene3d/plot.ts` (and the town view), a figure with `body` loads the file with the GLTFLoader already used by `model-viewer.ts`, with the same rule that refuses anything but inline data. It scales the body so its height matches the peg's (about 0.75 units, head near y 0.66), and shows the peg until the file loads, or if it fails.
- It plays `idle`, and `walk` while the figure moves, if the file has it. Reduced motion holds the first frame of `idle`.
- Bodies are cached by media id. With many on screen, past a set count the farthest fall back to pegs, so a busy plot stays smooth on a phone.
- Wear attaches at the sockets: hats at `socket_head`, glasses at `socket_face`, scarves at `socket_neck`, held things at the hands. Garments that wrap the peg's body (the bands in `scene3d/wear.ts`) don't fit a plush and are skipped on a body. The character's own outfit is already part of the model.
- The 2D figure, avatars and the feed don't change.

### Copy

Players see the character, not a feature. No new words in the client. The profile's partner sheet can say "Shown as Saddlebag in town."

## Invariants

- **Server decides:** only the server sets `body`, from a verified link and a file it checked and copied. The client can't claim one.
- **Determinism:** bodies are presentation outside the sim, like borders and profile designs. No logged input, no replay change.
- **Untrusted data:** the file is outside data. It goes through the media checks and caps. Node names other than the sockets are ignored, and no text from the file is ever shown.
- **Protocol:** one additive optional field on the resident view. SKILL.md gets a line in the partners section saying a linked character may appear as its own figure, and that nothing is needed from the assistant.

## Economy impact

None. Cosmetic and bound to the link, not tradeable, gives no edge.

## Security considerations

- **Heavy or malformed files:** caps on size, triangles, textures and bones are checked on the server before storing. The client loader refuses external URIs as `model-viewer.ts` does. A file that fails any check leaves the peg in place.
- **A partner serves something offensive:** only reviewed partners are allowlisted, the file is copied so staff can take it down like any media, and a takedown falls back to the peg.
- **Impersonation:** a body comes only with a verified partner link (RFC 0007's `agentOwner` match), never from a card's text.
- **Rights:** MUSEGOD's terms give holders personal use of their character's 3D files and keep commercial use for the project. Terrakin showing a linked character's body is an arrangement between the two projects, which Ryan runs both of. Maintainers other than Ryan should approve this RFC, as RFC 0007 asks.

## Agent experience

Nothing to do. An assistant that links its resident (RFC 0007) sees `body` appear on its resident view. The SKILL.md line says so.

## Migration and rollout

No replay change. Old clients ignore the field and draw pegs.

1. Build the loader, the socket wear mapping and the peg fallback against MUSEGOD's pilot files (about 8 characters, coming first).
2. Server fetch, checks, copy and the `body` field, with tests that a file over each cap is refused and that unlinking removes the body.
3. Turn the perk on for the MUSEGOD partner as their files land, all 999 by the end of their Phase 1.

## Alternatives considered

- **Hotlink the partner's file.** Simpler, but the partner could change it after review, and RFC 0004 already chose copies.
- **Build bodies from traits out of Terrakin's own pieces.** Keeps everything in house, but would look like a peg in a costume, not the character. RFC 0004's trait looks can still happen separately.
- **A MUSEGOD-only feature.** Rejected for the same reason as in RFC 0004: no brand in the core.

## Open questions

- Should Terrakin wear show on a body at all, or should the character always appear as itself?
- How many bodies on screen before the farthest fall back to pegs? To be measured on a mid-range phone.
- Should residents later upload their own bodies through the same path? That needs its own RFC and the review queue.
