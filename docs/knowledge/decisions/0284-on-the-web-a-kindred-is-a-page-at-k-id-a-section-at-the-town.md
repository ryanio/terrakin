---
title: On the web a kindred is a page at /k/:id, a section at the Town Hall, a chip on profiles, and a label under its hall's name
date: 2026-10-14
status: accepted
tags: [client, design, social]
---

# On the web a kindred is a page at /k/:id, a section at the Town Hall, a chip on profiles, and a label under its hall's name

## Context

RFC 0033's third step puts kindreds on the web, dark, as jobs came (decision 0261): nothing is asked for or drawn until the world says kindreds are open. Section 9 of the RFC sketches a kindred page, a Town Hall section, an invite sheet, a profile chip, a map label, and steps in the events journey.

## Decision

- `/k/:id` (`kindred-view.ts`) is a sidebar page: the name and its standing in the head; the invite you hold with Join and Not now, the notice, the kindred nights with Going, and the members in the main column; the hall, the steward's tools, and Leave beside them, after the main column on a phone. A button is one of the server's `you.moves`, and a refusal is the world's own words. The steward tools with no move of their own (Make steward, Remove for anyone not a steward, Take back, and Step down on your own row) show to a steward and the world checks them. Join shows on any invite you hold, even when the world would refuse it, so its refusal says why (full, your household's three already in, or your week's wait). Leaving, or turning down an invite, goes back to the Town Hall's Kindreds, since a forming kindred's page closes to you then.
- The invite opens this page from its notification rather than a sheet of its own: the page already shows the members and has Join and Not now, so a second view of the same choice would only drift from it.
- Stewards get their tools on the page, not in a menu: an Invite by handle form, and Edit notice, Rename, and Set the hall (their other plots, read from `GET /v1/events` when it's opened) behind disclosures. Moving the hall calls off its booked nights, so with one booked it takes a second tap. Hold a kindred night opens the Schedule sheet with the hall as its one place, and the sheet says how many members from how many households make the week count, from the page's `rules`.
- The Town Hall gets a Kindreds section after Jobs, asked for only once the world snapshot has `kindredsOpen`: yours first, your invites, the formed kindreds, and Found a kindred, which shows the fee and the forming rule.
- A profile shows the formed kindred a resident is in as a chip that opens its page.
- The map draws a hall's kindred name on a smaller paper tag under the plot's own name, or alone on a plot with no name, and the two tags move as one so neither leaves the plot. `kindred_hall` carries the name, so a client that never heard a forming kindred's founding still has it.
- The page's tags are generic (`private`, noindex): a kindred's name is residents' words.

## Consequences

`e2e/town.spec.ts` gains a test, the town's own server opening kindreds at its end. Nothing shows on terrakin.org until the Worker sets `kindreds`. Words and counts the page says are `packages/client/src/kindreds.ts`, pure and tested.
