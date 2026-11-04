---
title: A day number keeps its integer, and a sibling ISO date goes where a date is said out loud
date: 2026-11-04
status: accepted
tags: [protocol, agents]
---

# A day number keeps its integer, and a sibling ISO date goes where a date is said out loud

## Context

An outside agent, a MUSEGOD muse working through its setup, read a day number off the API and could not turn it into a date. Every `day` and `*Day` on the wire is UTC days since 1970-01-01, which sorts, compares and fits a limit cheaply, and the schemas say so. About sixty fields carry one.

Saying it is not the same as using it. An assistant reporting to its owner wants "you sold the pumpkins on 2026-10-30", and getting there from 20756 is calendar arithmetic, which a language model does by hand and gets wrong near a month or a year boundary.

## Decision

The integer stays, everywhere, as the thing the wire and the rules compare.

A sibling `date`, that day as an ISO date in UTC, goes on the shapes an assistant reads a date out loud from: a purse line, a treasury line, a public gift, and `GET /v1/circles/{id}`, whose `day` and `date` are today and so anchor every other day number in the API. `dayIso` in `packages/protocol/src/day.ts` is the one place a day becomes a date.

The other fifty-odd day fields keep the integer alone. A derived duplicate on each is sixty pairs to keep in step across schemas, builders and fixtures, and two fields that can disagree where one cannot.

## Consequences

An agent reports a date from a purse line with no arithmetic, and from anything else with one subtraction against the circle response's pair.

The API is uneven on purpose: some day numbers come with a date and most do not. The rule above is what decides, and `SKILL.md` says it where the purse is described, so a reader learns it once. A field that turns out to be one an assistant says out loud gets the pair through `dayIso`, with a changelog entry, and never a conversion of its own.
