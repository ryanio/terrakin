---
title: The world's sound is made with code, off until the speaker is tapped, and loaded then
date: 2026-10-06
status: accepted
tags: [client, design, performance, privacy]
---

# The world's sound is made with code, off until the speaker is tapped, and loaded then

## Context

The world was silent. A soft soundscape makes a cozy world feel alive, but sound has rules of its own. Browsers let a page make sound only after a tap, and iPhones want the audio started inside that tap. Plenty of people open the world on a bus or late at night, so sound that starts by itself is rude. Recorded audio would be files to download, store, and license, where [decision 0035](0035-draw-with-code-first-and-rasterize-only-at-the-edge.md) has the world drawn with code. And the first page load shouldn't grow for something most visits won't turn on, the way [decision 0013](0013-load-three-js-only-when-someone-opens-a-3d-model.md) keeps three.js out of it.

## Decision

Sound is synthesized with the Web Audio API: noise shaped by filters, and oscillators. There are no audio files and no dependencies.

The beds follow what the world view already knows. A light breeze plays always, rising and falling in gusts. Birdsong plays by day: a few birds around you, each singing its own song with every note varied, now and then flying off for another. Crickets and the odd owl take over at night, from the day's phase ([decision 0011](0011-day-and-night-is-presentation-anchored-by-the-server-clock.md)). Rain plays when `weatherAt` says rain ([decision 0073](0073-weather-is-a-pure-function-of-the-world-day-and-the-utc-hour.md)), and snow and fog bring a low hush and muffle everything else. Crickets sit out the winter and chirp slower in autumn. Birds and crickets crossfade through dusk and dawn, and every bed drifts to a new weather over a few seconds. `bedLevels` in `client/src/sound/mix.ts` picks the levels.

Small sounds mark your own moments, never anyone else's:

- a footstep for each step you take, on grass, snow in winter, or the path or floor underfoot, at most one every 150 ms;
- a knock in the block's material (wood, stone, glass, metal, leaf, or soft) when you place one, and a small pop when you remove one;
- a pat when you lay a path or plant a seed;
- a chime when someone waves, hugs, high-fives, comforts, kisses, or gives you something, admires what you made, or sends you coins, and when your appreciation coins arrive. At most one chime a second.

The speaker button sits on top of the world's actions, 52px round. It's off by default, and each tap steps it on, then quiet (about 8 dB down), then off. The choice is remembered on the device (`terrakin.sound` in localStorage). The AudioContext is made inside the tap that turns sound on, never before. On a later visit with sound on, the first tap or key anywhere in the world starts it, and the icon shows dimmed until then. While the page is hidden, or you've left the world, the mix fades out and the context is suspended; it resumes when you're back. In Safari the audio session is "ambient", so the world's sound plays alongside your own music instead of stopping it, and keeps to the silent switch.

The sound code (`soundscape.ts`, `voices.ts`, `mix.ts`) loads with `import()` on the first tap. Only the button and its setting (`switch.ts`, `setting.ts`) ride in the world's chunk.

`prefers-reduced-motion` doesn't apply: it's about motion, not sound, and sound is already off until asked for. The beds keep their crossfade even though the sky jumps straight to a new weather under it.

Analytics get nothing about sound. Sentry's click breadcrumbs already reduce the button to `button#sound.pill-button.hud-sound` ([decision 0015](0015-ga4-and-sentry-and-what-they-may-receive.md)).

## Numbers

Measured from three `OfflineAudioContext` renders of each in headless Chromium at 44.1 kHz, with sound on (quiet is 8 dB lower). Nothing clips. Birdsong came to 7 to 11 songs in 22 seconds.

| Sound | Peak (dBFS) | RMS (dBFS) |
|---|---|---|
| Clear summer day: breeze and birds | -21 to -20 | -37 to -36 |
| Clear summer night: breeze, crickets, owl | -19 to -18 | -37 to -36 |
| Rain | -22 to -20 | -35 to -34 |
| Snow | -23 to -20 | -36 to -35 |
| Fog | -26 to -24 | -39 to -38 |
| Footsteps | -31 to -25 | |
| Knocks, pops, and pats | -25 to -16 | |
| Chimes | -17 to -14 | |
| A rainy night with a chime, a knock, and footsteps at once | -13 | -31 |

The JavaScript the first page loads is the same size with sound as without it, to within 0.01 kB, measured on builds of main before and after. The world's chunk grows 1.1 kB gzipped, the page and its styles 0.3 kB gzipped together, and the sound code is a chunk of its own: 14.9 kB, 5.8 kB gzipped, downloaded on the first tap.

## Consequences

- Praise given from a profile doesn't reach the world's socket today, so it has no chime. Pushing it to the world would be a protocol change, with a toast to say why the chime played.
- A new block kind sounds like wood and a new path like soft ground until `mix.ts` says otherwise.
- The levels were set from the render, not by ear on a phone; a listen on real speakers may move a few of them. `BED_GAIN`, `STEP_GAIN`, and `MOMENT_GAIN` in `soundscape.ts` are the dials.
- Code: `client/src/sound/` (`setting.ts`, `switch.ts`, `mix.ts`, `voices.ts`, `soundscape.ts`), wired in by `client/src/world.ts`. Tests: `client/src/sound.test.ts` (the beds, the moments, the setting, the button with a faked AudioContext, the footstep limit, and the lazy boundary) and `e2e/sound.spec.ts` (no context and no sound code before the tap, and the choice across a reload).
