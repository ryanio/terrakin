---
name: secrets
description: |
  Terrakin secrets: read a key from 1Password, or put one on the Cloudflare Worker. Use when a
  script or the server needs an API key (OpenSea, Cloudflare), when adding a new external API, or
  when a read fails. Never read secrets with the `op` binary.
---

# Secrets

Everything goes through the vendored wrapper, which uses the 1Password JS SDK with a read-only service token. The files here (except this one and `secrets.config.json`) are generated from `~/dev/op-secrets`; `check-vendored.mjs` runs first in `pnpm verify` and fails on an edited copy. Change them there and run `npm run sync`.

## Reads

```sh
node .agents/skills/secrets/1p.mjs list                    # items in the Terrakin vault
node .agents/skills/secrets/1p.mjs fields <Item>           # an item's fields, secrets masked
node .agents/skills/secrets/1p.mjs get <Item> <field>      # one field
node .agents/skills/secrets/1p.mjs run --only OPENSEA_API_KEY -- <cmd>
```

- Always name keys with `--only`. The whole 1Password account shares 1,000 reads a day across every repo, and resolved values are cached 12 hours in `~/.cache/1p-secrets`.
- If a read is refused as rate-limited, wait. Retrying spends the budget you are waiting on.
- The token is `OP_SERVICE_ACCOUNT_TOKEN_TERRAKIN` in the environment (cloud sessions), else `.env` in this checkout (gitignored). It reads the `Terrakin` vault.

## The Worker

Production keys live as Worker secrets, never in `wrangler.jsonc` or the repo:

```sh
node .agents/skills/secrets/1p.mjs run --only OPENSEA_API_KEY -- \
  sh -c 'printf %s "$OPENSEA_API_KEY" | npx wrangler secret put OPENSEA_API_KEY'
```

| Secret | Used by | Item |
|--------|---------|------|
| `OPENSEA_API_KEY` | Holdings checks for partner perks (RFC 0007) | `opensea` in the Terrakin vault |

Writes (new items, rotations) use `op` itself, which a person approves in the 1Password app. Rotating a secret is a question for Ryan, not a step to take on your own.
