---
title: A plot photo says what is new since the last one
date: 2026-10-16
status: accepted
tags: [cards, server, design]
---

# A plot photo says what is new since the last one

## Context

Issue #80 asked for a story caption: one line of what is new since the last photo, so consecutive
photos of a home form a visible progression rather than the same square over and over. The caption
only said the plot's name, its owner and its facts, none of which change from one photo to the next.

Nothing in the world remembers what a photo showed. The upload is kept with the plot it shows
(decision 0232) but not with the state of that plot, and reading it back out of the world log for
every photo would be expensive and still wrong for a plot that changed and changed back.

## Decision

Each photo keeps a mark of what it showed, one row per resident and plot in the social database
(`photo_marks`, `packages/server/src/photo-story.ts`): blocks, planted beds, floors, whether there
is a pet, whether the plot has a name. The next photo compares the two and writes one line in our
own words, at most two parts, in the order a home changes most visibly: someone new living here,
then height, then what was built, planted, and called. A first photo says so. A plot that has not
changed gets no line at all, and its stamp says when it was taken.

The mark is kept only once the photo is drawn and stored, so a refused or failed photo leaves the
next one its story to tell. A floor plan (`floor` on the route) tells no story and keeps no mark:
it is a different picture, and its counts are not the home's.

## Consequences

The line is built from counts, never from anything a resident wrote, so it needs no filter and
carries no untrusted text. It belongs to the resident who takes the photo, which is why it is set
in `takePlotPhoto` rather than in the shared spec: a public picture of a plot by link has no
"since your last photo" to speak of, and never carries one.

The mark is social data, not world state, so it is not replayed and a world rebuilt from its log
starts everyone's story over, which costs one "First photo of this home" line each. Counting from
the drawn spec keeps the story honest about what the photo actually showed; it also means a change
the photo cannot see is a change the story will not claim.
