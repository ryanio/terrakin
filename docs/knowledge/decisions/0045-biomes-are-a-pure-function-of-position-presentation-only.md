---
title: Biomes are a pure function of position, presentation only
date: 2026-10-04
status: accepted
tags: [sim, client, design]
---

# Biomes are a pure function of position, presentation only

## Context

Phase-1 item 8 asks for "Biomes, simple gathering". Biomes are unblocked; gathering still needs
a scope call (RFC 0001 says no resources in phase 1, while phase-1.md lists "simple gathering
(pick up wood/stone)"; that call is open). This record covers biomes only.

The sim is deterministic and event-sourced: anything that varies must be logged or be a pure
function. Ground scenery must never be able to desync two servers or change a replay.

## Decision

- `biomeAt(config, x, y)` in `packages/sim/` is a pure function of tile position: `meadow | forest | stone | sand`.
- Biomes are hashed per 4x4-tile region (`BIOME_REGION`), so the world reads as broad organic
  patches instead of per-tile confetti, while the plot grid stays the legible unit.
- Biomes are presentation only in phase 1: no world state, no log entries, no protocol fields,
  no gameplay effect. The client renders ground tints from the same function the sim exports.
- The Commons keeps its existing sandy plaza rendering (client override); biome has no opinion
  about special places.
- The signature takes `config` so a future world seed can key the map. Today the map is fixed
  by coordinates alone.

## Why

- No state means no migration, no replay risk, and no protocol change: the entire feature is
  one pure function plus four client palettes.
- An integer hash of the region coordinates keeps it deterministic across every client, server, and replay, with no RNG to
  seed and no clock to read.
- Keeping gathering out of this change respects the pending scope call: when Ryan scopes
  gathering, `biomeAt` is already there for the sim to consult (e.g. forest yields wood).

## Consequences

- The biome map is identical on every world of the same size until a seed is added. That's fine
  for phase 1: there is one world.
- Trees, rocks, and other decorations per biome are a follow-up; this change ships tints only.
- Gathering design must cite this decision if it attaches gameplay to biomes. [Decision 0063](0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md) does: pickups fall by biome, so `biomeAt` now affects which logged `gather`s replay.

## Note on the hash

The first version read the top bits of FNV-1a over `terrakin-biome|rx|ry`. The last characters
hashed barely move those bits, so regions matched the one below them about nine times in ten and
the map came out as vertical stripes. `biomeAt` now mixes the two integers with a finalizer (the
same style as the client's `tileHash`), and `biome.test.ts` checks that neighbors match about as
often across as down, and pins the region map so a later change is deliberate.
