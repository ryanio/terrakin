# @terrakin/server

Authoritative game server. Every number the game shows is a number the server believes. Client input is validated, never trusted.

```sh
pnpm --filter @terrakin/server dev                       # in-memory world, hot reload
TERRAKIN_DATA_DIR=./data pnpm --filter @terrakin/server start   # persist to JSONL
```

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | HTTP + WebSocket port |
| `TERRAKIN_DATA_DIR` | unset (memory) | Directory for the append-only world log and session hashes |
| `TERRAKIN_STATIC_DIR` | unset | Serve a built client from this directory |
| `TERRAKIN_TRUSTED_PROXIES` | `0` | Reverse proxies in front of the server. Only set it if a proxy appends to `X-Forwarded-For`, or clients can spoof their IP. |

Storage is behind a `Store` interface: `MemoryStore` for tests and dev, `JsonlStore` for a Node server or a self-hosted container, and `SqlStore` for the Durable Object that runs terrakin.org. Postgres and Redis are retired, not pending ([decision 0317](../../docs/knowledge/decisions/0317-postgres-is-retired-the-durable-object-s-sqlite-is-the-store.md)); sessions are still bearer tokens with only their hash stored ([decision 0005](../../docs/knowledge/decisions/0005-phase-1-storage-and-identity.md)). Rules for contributors: [AGENTS.md](AGENTS.md).
