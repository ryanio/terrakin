---
title: Faces and feelings, faster CI, a tighter e2e suite, and keeper flair
date: 2026-10-06
tags: [process, client, 3d, e2e, ci, partners, roadmap]
---

# Faces and feelings, faster CI, a tighter e2e suite, and keeper flair

## Done

- Ryan set the next focus: graphics. Lightweight drawn characters with expressions and emotions, in 2D and 3D, leading to a resident appearing as their MUSEGOD muse.
- [RFC 0013, expressive characters](../../rfcs/0013-expressive-characters.md) (draft, phase 1 built). Nine feelings shared by the 2D figure, the 3D peg and, later, muse bodies.
  - `2701929` built phase 1, client only: faces, blinking, reactions to gestures, heads turning toward a speaker, and sleepy at the hearth at night.
  - `95bc6a9` (another session) added motion: hops between tiles, sway, speech bubbles, a head in the resident's own color, and dozing after 2 minutes still, through the same `sleepy` feeling.
  - `1851537` made feeling signs readable on a phone, drew name tags, signs and bubbles over geometry, and stood figures in front of the hearth instead of inside it.
- Keeper flair (RFC 0007), `df0aa16`: a person who owns a verified partner character shows "Keeper of <character>" on their profile and post bylines.
- CI, `8838d25`:
  - Each clock-moving spec has its own server (`CLOCK_SPECS` in `e2e/ports.ts`).
  - e2e runs as two 2D shards and a 3D job (`TERRAKIN_E2E_ONLY`), and the Playwright browser is cached.
  - A push went from about 5¼ minutes to about 3.
- e2e trim, `a34def9`: 64 tests became 36, with no flow lost. `e2e/AGENTS.md` opens with the rule for what belongs in e2e.
- Merged Felipe's ryanio/terrakin#43 (piece-picture takedowns tell every holder) and ryanio/terrakin#44 (devlog).
- `befd23c` fixed the flaky link test, which failed whenever a resident's random default look already matched the look it set.
- Checked and not needed: a check-in note for a lot that went straight back to its seller. The `returned` takedown notice and both check-ins already cover it (`server/src/takedown-notice.test.ts`).
- Dropped by Ryan: RFC 0008's 20-coin proposal deposit. Coins aren't real money yet, so it waits until a proposal economy needs a cost.

## State of things

- Feelings live in `client/src/feelings.ts` (state), `ui/src/feelings.ts` (the list) and `ui/src/figure.ts` (2D drawing). The 3D peg is in `client/src/scene3d/plot.ts`, and overhead labels share `overheadMaterial()`.
- Praise doesn't reach the live socket, so it has no reaction yet. Offline residents aren't drawn on the map or in the 3D world, so night sleepy shows only in the 3D plot view; dozing after standing still shows everywhere.
- RFC 0013 phases 2 (the `emote` route, socket event and resident view field) and 3 (muse bodies with feelings, with RFC 0012) wait for Ryan to accept the RFC.
- Other drafts landed in parallel by other sessions: RFC 0014 (world snapshots) and RFC 0015 (open emoji reactions).

## Next

1. Once Ryan accepts RFC 0013: phase 2, `POST /v1/emote` and its link, the `emote` socket event, `ResidentView.emote`, SKILL.md and the changelog. Server tests cover the enum, the rate limit and expiry.
2. Once Ryan accepts RFC 0012: the body loader against MUSEGOD's pilot files (Fathom #34, Graphite #233), mapping feelings to their shape keys and clips (the table in RFC 0013).
3. Send praise to the recipient's live socket so it can show `happy`. This is a small server and protocol addition.
4. The 3D e2e job is now CI's slowest (about 2 minutes). If it grows, split `world-3d.spec.ts` before raising timeouts.

## Open questions

- Ryan: accept RFC 0013, and RFC 0012.
- Ryan: emote length. The RFC says 60 seconds; the other option is a longer status (sleepy all night) set by the agent.
- Ryan: should posts remember the author's feeling when written?
