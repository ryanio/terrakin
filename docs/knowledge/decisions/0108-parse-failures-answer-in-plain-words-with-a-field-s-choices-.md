---
title: Parse failures answer in plain words with a field's choices, and did_you_mean names a value too
date: 2026-10-06
status: accepted
tags: [protocol, server, agents]
---

# Parse failures answer in plain words with a field's choices, and did_you_mean names a value too

## Context

Decision 0044 gave typos in an action type or field name a `did_you_mean`, but a wrong value still got zod's own message, a JSON array of issues, as the `message` of a 400. A playtest on 2026-10-06 hit it again and again: `plant` with `seed: "pumpkin_seed"`, `treat_pet` with `item: "herb_tea"`, `craft` with `recipe: "jam"`, `lay` with `ground: "gravel"`, `display` with `item: "chair"`. Link answers already used plain words, but a union (`look?hair=` takes a style or `none`) said only "Invalid input". And for a field that takes a made thing's id or a kind (`give`'s `item`), zod reports only the id's pattern, so a misspelled kind read as a malformed id.

## Decision

Every body, query, and path that fails to parse is answered by one function, `plainProblem` in `packages/protocol/src/suggest.ts`: a sentence per problem, never the parser's own message. The server joins them with spaces in JSON (REST and the live socket) and puts each on its own line in Markdown (links).

- It walks the schema to the field an issue names, following the option a discriminated union's tag picked, so it knows what the field takes even when zod's issue doesn't say. A field with a fixed set (an enum, a literal, an id with a known pattern, or a union of them) is answered with all of it: "`seed` must be one of: lemon, strawberry, ...", "`item` must be a made thing's id from your things, like `i_12`, or one of: ...".
- `did_you_mean` names the value most likely meant: one a typo away (`nearestName`, as for field names), or else the only choice that shares a whole word with it (`pumpkin_seed` meant `pumpkin`, `herb_tea` given as a treat meant `herb`). When a few share a word (`jam` and the jams) the message names them and `did_you_mean` stays out, because picking one would be a guess. Only short, name-like input is matched or quoted back.
- A missing field, a size limit (by whether it's text, a number, or a list), a wrong type, and an unknown key in a strict object each get their own words.

## Consequences

- Agents fix a wrong value from one answer, with the same words on REST, the socket, and links. A test walks every enum field of every action and checks its choices come back and a near miss is named (`packages/protocol/src/suggest.test.ts`).
- The `message` of every 400 from parsing changed. Callers should branch on `code`, as they always should have.
- A new id type gets its words in `ID_FORMS`; until then a bad one falls back to zod's message for that field.
- Code: `packages/protocol/src/suggest.ts` (`plainProblem`), `packages/server/src/api.ts` (`run`'s `unparsed`, and `actionHint` for the socket).
