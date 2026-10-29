---
name: secrets
description: |
  Terrakin secrets: read a key from 1Password, or put one on the Cloudflare Worker. Use when a
  script, an agent, or the Worker needs a key (the staff key, the Access token, a Worker secret), when adding a new external API, or
  when a read fails. Never read secrets with the `op` binary.
---

# Secrets

Everything goes through the vendored wrapper, which uses the 1Password JS SDK with a read-only service token. The files here (except this one and `secrets.config.json`) are generated from `ryanio/op-secrets`; `check-vendored.mjs` runs first in `pnpm verify` and fails on an edited copy. Change them there and run `npm run sync`.

## Reads

```sh
node .agents/skills/secrets/1p.mjs list                    # items in the Terrakin vault
node .agents/skills/secrets/1p.mjs fields <Item>           # an item's fields, secrets masked
node .agents/skills/secrets/1p.mjs get <Item> <field>      # one field
node .agents/skills/secrets/1p.mjs run --only TERRAKIN_STAFF_KEY -- <cmd>
```

- Always name keys with `--only`. The whole 1Password account shares 1,000 reads a day across every repo, and resolved values are cached 12 hours in `~/.cache/1p-secrets`.
- If a read is refused as rate-limited, wait. Retrying spends the budget you are waiting on.
- The token is `OP_SERVICE_ACCOUNT_TOKEN_TERRAKIN` in the environment (cloud sessions), else `.env` in this checkout (gitignored). It reads the `Terrakin` vault.

## The Worker

Production keys live as Worker secrets, never in `wrangler.jsonc` or the repo. To put one there from the vault (`KEY` declared in `.env.tpl`):

```sh
node .agents/skills/secrets/1p.mjs run --only KEY -- \
  sh -c 'printf %s "$KEY" | npx wrangler secret put KEY'
```

The Worker's secrets and what each turns on are in [docs/deploy.md](../../../docs/deploy.md) (the env var table: `ANTHROPIC_API_KEY`, the staff emails, `TERRAKIN_STAFF_RESIDENTS`, `TERRAKIN_CHAIN_RPC`, `MUSEGOD_WORLDS_KEY`). The keys this wrapper can read are the ones in `.env.tpl`:

| Key | Read by |
|-----|---------|
| `TERRAKIN_STAFF_KEY` | Staff calls an agent makes for Ryan, and `pnpm funnel` |
| `TERRAKIN_ACCESS_CLIENT_ID`, `TERRAKIN_ACCESS_CLIENT_SECRET` | `scripts/replay-check.ts` from a laptop; CI has its own copies as GitHub secrets |
| `OPENSEA_API_KEY` | Nothing yet: holdings matching (partners phase 4 in `docs/plans/README.md`) is unbuilt |
| `XAI_API_KEY` | Nothing in this repo yet |

`TERRAKIN_STAFF_KEY` is Ryan's staff key, for staff work he asks for in a chat (re-key codes, the review queue, merges, clearing a block, laying public ways). It has the `role` scope, so it reaches every maintainer route, and lives in the `Terrakin maintainer key` item. It goes only to `https://terrakin.org/v1/...` and never onto the Worker. Only Ryan makes one, in the staff app's Keys signed in as himself: an agent can't, because a key's scope is a permission he grants. When a staff call answers `unauthorized` (expired or revoked) or `forbidden` naming the key's scope, ask him for a new `role` key, 90 days, saved over that item's credential, and don't try another route around it. How to call it: [docs/staff-agents.md](../../../docs/staff-agents.md#calling-the-staff-routes).

Writes (new items, rotations) use `op` itself, which a person approves in the 1Password app. Rotating a secret is a question for Ryan, not a step to take on your own.
