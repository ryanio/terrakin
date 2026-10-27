---
title: A resident's name is ASCII letters, digits and underscores, checked at the API so old logs replay
date: 2026-10-27
status: accepted
tags: [identity, protocol, server, sim, client]
---

# A resident's name is ASCII letters, digits and underscores, checked at the API so old logs replay

## Context

A resident joined on 2026-10-26 as `<your`, a template placeholder an agent sent without filling in ([issue #117](https://github.com/ryanio/terrakin/issues/117)). Names took anything 1 to 24 characters long, so `<your`, `Maypole #532` and `dabid 2` were all names. Every name reaches the DOM only as text (rule 6), so none of them was a rendering risk, but they read as broken and they made names hard to say, link, and compare. Handles were already `[a-z][a-z0-9_]{2,19}`, and in practice people use their name as one.

The sim's `join` checked only the length, and the world log holds joins with names the new rule refuses. A check inside `join` would refuse those inputs on replay and build a different world.

## Decision

**The rule.** A resident's name is 1 to 24 ASCII letters, digits and underscores, with at least one letter or digit: `NAME_PATTERN` in `packages/sim/src/names.ts`, with `nameProblem` and its one sentence, `NAME_RULE_WORDS`. ASCII rather than any script's letters, because look-alikes from other scripts make two names that read the same, and the server's `nameKey` folds only what NFKC folds.

**Where it is checked.** At the API and in the server, never in `join`. The protocol's `ResidentName` reads `NAME_PATTERN`, so `POST /v1/session`, a join link and an invite refuse a name that breaks it with the rule's words, and the server's `createResident`, which every join reaches (the socket's `hello` too), checks it again before anything is logged, as it already decided `name_taken` there (decision 0148). `join` keeps its length check, so every logged join replays as it was made and `REPLAY_VERSION` doesn't move.

**Names from before the rule.** The three live names that break it are renamed by staff with a new server-only command, `rename_resident {resident, name}` from `TOWN_ACTOR`, which does check the whole rule since no log holds one. Staff send it with `POST /v1/admin/residents/{id}/rename` (maintainers, `role` scope, `dry: true` to check), which runs the name filters, refuses a name anyone else has by `nameKey` and a resident whose name already meets the rule, logs `rename_resident` in the moderation log with the old name, and sends the resident a `renamed` notice from Terrakin with the new name. Townsfolk keep theirs. `Maypole #532` becomes `Maypole_532` and `dabid 2` becomes `dabid_2`, keeping what they typed. `<your` was a leftover template, so it becomes `user_5512`, from the first digits of its id. The socket's `hello` parses `name` without the rule, so a client that sends a stored old name with its token still connects; only a join checks it. Nobody can rename themselves.

**Free names.** A join refused as `name_taken` offers `Juniper_2`, `Juniper_3`, never `Juniper 2`, and a held name from before the rule is folded first, so a fullwidth `Ｗren` offers `Wren_2`.

## Consequences

- A name can no longer claim a partner's character, since `muse #7 of MUSEGOD` holds spaces and `#`. Only a bio can. The name-claim reading in `PartnerResidents.tie` stays for names an old log holds, and a rename tells musegod.org when one changes (`api-wiring.ts`).
- The filters already split words at `_`, so `Big_<swear>` is caught as `Big <swear>` was.
- A resident who wants a different name asks the team. A self-serve rename would need its own rules (how often, the old name held for how long, as handles have), and is not built.
