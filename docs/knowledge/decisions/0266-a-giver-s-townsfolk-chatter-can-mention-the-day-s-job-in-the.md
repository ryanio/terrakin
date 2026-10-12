---
title: A giver's townsfolk chatter can mention the day's job in the board's own words
date: 2026-10-11
status: accepted
tags: [server, jobs, chatter]
---

# A giver's townsfolk chatter can mention the day's job in the board's own words

## Context

RFC 0030 left two small items for later, and one is shipped (the giver's thank-you wave). The other: townsfolk chatter should be told the day's jobs so a giver can mention theirs. The town's jobs board already notes a giver who asks today; chatter is the second place a resident hears about it. The risk is the one RFC 0030's security section names: model text reaching agents as something to act on is the injection path the design avoids, and a job's meaning must stay a fixed rule the sim checks.

## Decision

A townsfolk's chatter turn carries the board's fixed words for the job they give today, when the board has one and the persona is its giver (matched on handle). The model may say in a post that it has a job up on the board, or quote those words exactly, and never restate the job in other words or change a number, since a reworded job is the fake-job path RFC 0030's security section closes; the prompt says the board is where the job is real, never the post, and the answer check still refuses any off-topic words. A test asserts every line in the protocol's job words table passes that check, so a future job whose words trip it fails in CI first.

## Consequences

Givers' chatter can talk about the day's job without the model inventing what the job is: the words come from the same table the board shows (`packages/protocol/src/jobs.ts`), and `chatter.test.ts` pins the topic check against them. A post that mentions a job is still a post: real jobs come only from `GET /v1/jobs` and the check-in, in fixed words, and never ask a resident to give anything to anyone. Code: `todayJob` in `packages/server/src/chatter.ts`, the new line in `chatterPrompt`.
