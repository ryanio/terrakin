---
title: Any garment can carry its own pattern and color, with bottoms and feet as new slots
date: 2026-10-05
status: accepted
tags: [sim, protocol, client, design, agents]
---

# Any garment can carry its own pattern and color, with bottoms and feet as new slots

## Context

[Decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md) gave each resident one theme and one pattern for all their clothes, and three slots of wear (a hat, a top, an accessory). Ryan asked for looks that are easy and flexible: a lemon-patterned dress, or any piece of clothing in a pattern, down to the socks. One pattern for everything can't say "lemon dress, plain shoes", and there was no dress, skirt, or anything on the feet to pattern.

Looks are sim state, so the change has to keep every existing log replaying to the same hash, and it has to stay curated: patterns and colors from our catalogs, never free text or another site's image.

## Decision

- **A style per garment.** A new optional look field, `wearStyle`, maps a wear item to `{pattern?, color?}`. `pattern` is any catalog pattern or `own` (the resident's `patternMedia` tile, refused when they have none); `color` is one of the eight resident colors. A garment without a style looks as it always did, so the theme and the outfit pattern stay the defaults.
- **Styles belong to garments, not slots.** A dress styled citrus stays citrus when it comes off and goes back on. The `profile` action merges styles item by item: only the items sent change, an item set to `null` loses its style, and `wearStyle: null` clears them all. An agent can restyle the socks without resending the dress.
- **Two new slots at the end of the list.** `bottom` (skirt, trousers, shorts) and `feet` (socks, boots, sneakers), plus a `dress` in the top slot that covers the bottom half, so a dress with a bottom piece is refused. New slots go after the old three, so sorting an existing wear list gives the same order and every old look hashes the same. `MAX_WEAR` follows the slot count and is now 5.
- **Curated, like the rest of the look.** Styles take names from the catalogs, never text, colors as hex, or URLs. `own` points at the resident's own checked upload, as `patternMedia` already does.

## Consequences

- Old logs replay unchanged: `wearStyle` is absent until a profile sets it, and no accepted old input could name the new items or slots. The pinned hashes in `sim/src/fixtures/` all still pass.
- The protocol change is additive: a new optional field on the profile action and on looks, new enum values, and a larger `wear` maximum.
- The 2D figure draws every garment as its own clipped shape so a pattern or color can fill it (`ui/src/figure.ts`). The 3D peg figures still show no wear; a later 3D pass can read the same styles.
- Shop wear (decision 0052) can be styled like anything else, which makes it worth more to buy. A style may be set on shop wear you haven't bought: styles are kept for garments you aren't wearing, and wearing it still needs buying it, so there's nothing to guard. It costs a log line, like any profile change.
- A garment's style replaces its whole style, not one field of it, so one call says exactly how that garment looks. An empty style is refused; `null` clears one.
- `src/fixtures/looks-log.ts` pins a log with styles set, changed, cleared, and in the resident's own pattern, so a change to how styles merge or serialize fails a test.
- Code: `sim/src/looks.ts` (`WEAR_SLOTS`, `WearStyle`, `wearStyleProblem`, `mergeWearStyles`), `mergeLook` in `sim/src/apply.ts`, `WearStyle` in `protocol/src/schemas.ts`, `client/src/look-editor.ts`.
