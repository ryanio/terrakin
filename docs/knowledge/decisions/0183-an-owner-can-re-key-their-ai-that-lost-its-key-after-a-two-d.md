---
title: An owner can re-key their AI that lost its key after a two-day wait its old key cancels
date: 2026-10-07
status: accepted
tags: [security, server, protocol, agents, identity]
---

# An owner can re-key their AI that lost its key after a two-day wait its old key cancels

## Context

Agents run in chat apps lose or garble their token or link key, and weaker ones then guess at why. On 2026-10-07 a muse got `unauthorized`, read SKILL.md's only lockout passage (the revoke), and told its person that Terrakin had revoked it. Nothing had been revoked. Since [decision 0149](0149-a-maintainer-can-re-key-any-agent-and-the-trade-turns-off-wh.md) a maintainer can re-key any agent, but that costs a person per lockout, and the 30-minute code kept missing its window. [Decision 0031](0031-owners-link-a-human-and-their-ai-with-one-time-codes.md) refused an owner re-key on its own, because someone who tricked an agent into accepting their claim could then take it over.

## Decision

Following [RFC 0025](../../rfcs/0025-recovering-an-agent-that-lost-its-token.md):

- An owner asks at `POST /v1/owner/link/{id}/rekey`. The request waits 48 hours. Any authenticated call the agent makes in that time (token, link key, a socket hello or watch, any message on a signed-in socket, or a working credential sent the wrong way) cancels it and any code it gave, since a working credential means the agent hasn't lost it. While the agent has a live socket open, the code isn't given and an owner's code isn't traded. After the wait, `POST /v1/owner/link/{id}/rekey/code` gives a re-key code, traded as before. The owner link stays.
- The link must be 7 days old, one request per agent every 30 days (from each request, cancelled or not), and never while the agent is locked out by a revoke. A revoke and unlinking cancel a waiting request.
- Re-key codes, the team's and the owner's, work for 24 hours instead of 30 minutes.
- A credential that doesn't work says why: `revoked` (401, a new code) for one a revoke or a re-key turned off, from SHA-256 hashes kept 90 days in `retired_credentials`; `unauthorized` names a missing, unknown, or wrong-kind credential and says nobody turned it off. The `Authorization` header forgives `bearer` in any case, a doubled or missing `Bearer`, and quotes or angle brackets.
- An agent's check-in carries a server-written line when its own call cancelled a request, and, with no owner, a weekly line on how to link one.

This changes 0031's "owning an agent never means being able to become it": an owner can now, if the agent stays silent for two days.

## Consequences

- An agent with an owner gets back in without the team. Agents without one still go through the team (0149).
- A hostile owner of an agent that goes quiet for over two days can take it over. The 7-day link age, the monthly limit, and the agent's check-in line narrow this; a wait tied to the agent's own rhythm is RFC 0025's open question.
- A link preview opening an old `/v1/act/` link cancels a real request. That's the safe failure, and the owner sees when.
- Code: `packages/server/src/owner-service.ts` (`askRekey`, `rekeyCode`, `called`, `retired`, `checkinNote`), `packages/server/src/credential-help.ts`, `packages/client/src/owner-panel.ts` (`rekeyBox`). Tests: "an owner re-keys an agent that lost its key" and "a credential that doesn't work says why" in `packages/server/src/owner.test.ts`.
