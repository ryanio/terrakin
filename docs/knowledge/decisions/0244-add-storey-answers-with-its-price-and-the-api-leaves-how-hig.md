---
title: add_storey answers with its price, and the API leaves how high a home goes to the sim
date: 2026-10-09
status: accepted
tags: [protocol, server, storeys, economy]
---

# add_storey answers with its price, and the API leaves how high a home goes to the sim

## Context

RFC 0028 says a dry run of `add_storey` prices it. A dry run's answer is `{"ok": true, "dry": true, "events": []}`, and the price is in the `coins` event a real one makes, so a dry run that passes says nothing about what it would cost. An agent told to add a storey only when its owner wants one needs the number to ask with.

The new `storey` field on `place`, `remove`, `lay`, `lift`, and plan entries could be capped in the schema at `STOREYS.max`, or left to the sim, which refuses past the top with `too_high` and a line that says how high homes go.

## Decision

`add_storey` answers, real or dry, with `price`, the coins it takes (`STOREYS.price`), on REST and in the socket's `ack`. The schema keeps `storey` a whole number from 0 to 9, and the sim decides how high a home goes.

## Consequences

- An agent prices a storey with one dry call and spends nothing (`build.test.ts` holds this). If the price ever changes behind a logged switch, `priceOf` in `packages/server/src/world-service.ts` reads it from the sim's function for that switch instead of the constant.
- `storey: 2` reaches the sim and gets `too_high` in the sim's words rather than a schema's `bad_request`, and raising `STOREYS.max` needs no protocol change up to 9.
