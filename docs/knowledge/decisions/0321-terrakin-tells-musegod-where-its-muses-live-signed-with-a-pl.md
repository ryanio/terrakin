---
title: Terrakin tells musegod where its muses live, signed with a place key and dropped on failure
date: 2026-10-20
status: accepted
tags: [server, partners, integration]
---

# Terrakin tells musegod where its muses live, signed with a place key and dropped on failure

## Context

musegod.org keeps a record of every place each of its 999 muses lives, and Terrakin is one of
them. Until now that record was filled by a crawl alone: a Worker there reads
`GET /v1/partners/musegod/residents` every 15 minutes and folds what it finds into the record,
which the muse page, the muse API, each muse's ERC-8004 agent file and musegod.org/worlds all read.

Step 8 of musegod's `plans/muse-worlds.md` is that the two places musegod owns, Terrakin and the
flock, say so as it happens instead of waiting to be crawled. The musegod half went live on
10-18: `POST /api/v1/muses/<id>/worlds` takes a report signed by a place's own key, and Terrakin's
address is registered there. This is Terrakin's sending half. The flock's is its own change in its
own repo; the two share no code.

Three things had to be settled.

**What may be said.** A place knows where a muse is and nothing more. Who holds a muse is read
from the chain by musegod itself, and whether a place shows on a muse's page is the holder's
signature and Ryan's override. So a report carries one of `joined`, `linked` and `left` for one
muse, and nothing else. The endpoint enforces that too, but Terrakin should not be trying.

**How it is signed.** musegod recovers an EIP-191 signature over a fixed line that names the place,
and this repo deliberately has no chain library: `chain.ts` reads contracts with four hand-written
ABI selectors over `fetch`. Signing needs keccak-256 and secp256k1 with recovery, and WebCrypto has
neither.

**What a failure costs.** A report that doesn't arrive costs at most 15 minutes, because the crawl
still runs and is staying on.

## Decision

`packages/server/src/musegod-worlds.ts` holds `MusegodWorlds`, which signs the one line musegod's
`placeLine` builds and POSTs it, for the `musegod` partner alone and only while
`MUSEGOD_WORLDS_KEY` is set, which is a Worker secret and so unset in every other deployment, on
Node, and in the tests.

`@noble/curves` and `@noble/hashes` are the two dependencies that buys. They are what viem signs
with underneath, they are pure ESM with no Node APIs, and a test pins one signature against viem's
own output for a made-up key, so the repo keeps its "no chain library" rule in the sense that
matters: no RPC client, no ABI codec, no wallet.

A report goes out after the write it reports has committed, and nothing waits on it. A failure is
logged as a code and a status and dropped. The sender holds itself to musegod's limit of ten
reports a minute.

What a resident is to the partner is read through `PartnerResidents.tie`, the same rule
`GET /v1/partners/musegod/residents` builds its list from, so the two can never disagree about a
muse. The last report sent for each resident is kept in `musegod_worlds`, so an hourly link
recheck, a rejoin, or a profile save that changes nothing sends nothing, and a resident that moves
from one muse to another gets a `left` for the old one before the new one is reported.

`wireSocial` calls it from the four places a tie can change after they have committed: a link made,
ended or rechecked (`onPartnerPerks`), a bio saved (`onBioChanged`), a committed `join`, which is
the only input that sets a resident's name, and a record retired or merged away.

## Consequences

A muse that arrives, links or leaves shows on musegod within seconds rather than up to 15 minutes,
and the record no longer depends on the crawl reading a list in the shape it happens to take.

The crawl stays at four runs an hour. Dropping it to hourly is musegod's own change, and only once
both places have pushed for a week with nothing the push missed.

Two cases are left to the crawl on purpose: a suspended resident, who leaves the list without any
write of ours running, and any report the key, the network or the minute's limit refused. Both are
corrected on the next crawl, which is the reason a dropped report is acceptable at all.

The key is Terrakin's alone. If it is ever rotated, musegod's `PLACE_KEYS.terrakin` changes with
it; until then a wrong key shows as a 403 in the Worker's logs and in the `musegod_worlds.report`
count, and nothing else breaks.
