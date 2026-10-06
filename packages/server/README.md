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

Phase 1 stores state in JSONL files. Postgres and Redis come with Phase 2 (see [decision 0005](../docs/knowledge/decisions/0005-phase-1-storage-and-identity.md)). Rules for contributors: [AGENTS.md](AGENTS.md).
