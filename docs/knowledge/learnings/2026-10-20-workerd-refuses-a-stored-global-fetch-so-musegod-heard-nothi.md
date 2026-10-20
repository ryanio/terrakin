---
title: Workerd refuses a stored global fetch, so musegod heard nothing
date: 2026-10-20
tags: [server, cloudflare, partners, testing]
---

# Workerd refuses a stored global fetch, so musegod heard nothing

**Symptom:** muse #649's link to a resident finished on terrakin.org, and musegod.org showed the
Terrakin spot, but only from its 15-minute crawl: no stored report (`worlds-report:649:terrakin`
was a 404 in its KV, while the flock's own push had written `worlds-report:649:flock` with
`"by":"place"`). The Worker's logs held no `musegod worlds:` line for the whole evening, which
reads as "no report was ever attempted", since a refused one logs its status and a held one says
so.

**Cause:** `MusegodWorlds` kept the runtime's own `fetch` as a field (`this.send = options.fetch ??
fetch`) and called it as `this.send(...)`. That passes the instance as `this`, and workerd refuses
its global `fetch` called as a method of anything else: `TypeError: Illegal invocation`. The throw
is synchronous, so it escaped `post` before any request went out, escaped `tell` before its
bookkeeping row, and landed in `wireSocial`'s own try/catch, which reports and drops. `report()`
writes to Sentry only, so the Workers log stayed empty while Sentry held 8 events from three
separate paths (the alarm's recheck, `POST /v1/agent-link`, and a `join`). Node's fetch takes any
`this`, and every test passed its own `fetch`, so nothing before production could see it.

**Fix:** default an injected fetch to a wrapper, which is what the other five modules here already
do: `options.fetch ?? ((input, init) => fetch(input, init))`. `musegod-worlds.test.ts` now builds
the sender with no `fetch` option against a global that refuses a wrong `this`, the way workerd
does, so the default path is exercised; `post` also drops a throw the way it drops a rejection, so
one failed report no longer abandons the second one and the row behind it.

The general rule, now in [packages/server/AGENTS.md](../../../packages/server/AGENTS.md) under
"Both runtimes": never store a runtime global as a method, and never leave the default path of an
injected dependency untested, because what the tests inject is the only thing they prove.
