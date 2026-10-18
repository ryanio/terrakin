---
title: A durable object stub's fetch settles on its headers, so a broken body escapes the retry
date: 2026-10-17
tags: [server, cloudflare, telemetry]
---

# A durable object stub's fetch settles on its headers, so a broken body escapes the retry

**Symptom:** one Sentry issue on terrakin.org, `Error: Network connection lost.` on
`GET /v1/world`, tagged `handled=no` and `mechanism=auto.http.cloudflare`. Decision 0292 says a
read the World object broke goes again once and anything still broken is answered `unavailable` in
the API's own shape, never as a 500, and `askWorld` reports a refusal itself as `world.fetch`. An
unhandled error on that route meant our own code never saw it.

**Cause:** `stub.fetch()` settles as soon as the object's headers arrive; the body streams after
it. An object that restarts mid-answer therefore breaks the stream, not the call, so the `await`
in `askWorld` had already returned and the caller had already passed the response on. The runtime
hit the error while pumping the body to the client, which is why it reached the client as a failed
read and Sentry as an error nobody handled. `/v1/world` is the biggest answer the object sends
(about 65 KB), so it is the one most likely to still be streaming when that happens.

**Fix:** `inHand` in `packages/server/src/pages.ts` reads the answer's body before `askWorld`
returns, which puts the break inside the try where the retry can see it. An answer with no body (a
socket upgrade, a 204, a 304) passes through as it is. Buffering costs nothing worth measuring
here: the object sends JSON only, media comes from the bucket and cards from the cards Worker, and
the biggest answer moves in about 4 ms once its headers are out.

The general rule: a retry wrapped around `fetch` alone only covers failures up to the headers. To
cover the whole answer, the retry has to hold the body too.
