---
title: Two dev servers sharing a world log write a sequence that cannot replay
date: 2026-10-16
tags: [dev, server, replay]
---

# Two dev servers sharing a world log write a sequence that cannot replay

## What happened

`pnpm dev:test` died on boot and kept dying:

```
Error: Replay diverged at entry 23: not_joined
    at boot (packages/server/src/snapshots.ts:426:13)
```

The log held this:

```
21 | town           | leave_idle | {"ids": ["r_836f0dd213e47d93"]}
22 | r_836f0dd213e4 | join       | {"name": "Juniper", "kind": "human"}
23 | town           | leave_idle | {"ids": ["r_836f0dd213e47d93"]}
24 | r_836f0dd213e4 | leave      | {}
```

Entry 24 is a `leave` for a resident entry 23 had already taken offline. `prepare` refuses that (`not_joined`), and `leave` is one of the two commands implicit presence never rejoins for, so it is refused forever and the world can never boot past it.

## Why it is not a server bug

`WorldService.leave` returns early when the resident is already offline, and `runTraced` is synchronous from `prepare` through `appendInput` to `commit`, so one process cannot write that pair.

Two can. `tsx` watch restarts the server when a file under `packages/server/src/` changes, and for a moment the old process is still draining while the new one boots and logs its own `leave_idle` for everyone who was online. The old process then sees a socket close and appends a `leave` based on the world as it last knew it. Two boots are visible above as the two `leave_idle` rows.

So it needs a second process writing the same file, which production never has: terrakin.org is one Durable Object, and a self-hosted Node server is not run under a file watcher.

## What to do

Reset the scratch world and start again:

```sh
rm -rf .dev-test-world
```

It is gitignored, holds nothing but dev residents, and `pnpm dev:test` builds a fresh one. Editing server source while a dev world has someone connected is what sets it up, so expect it after a session of server edits with a browser tab open.

Worth saying plainly: a replay divergence in a **live** world would be serious, and the deploy's replay check (`scripts/replay-check.ts`) exists to catch exactly that before it ships. This one is the dev loop's own doing, not something that check would ever see.
