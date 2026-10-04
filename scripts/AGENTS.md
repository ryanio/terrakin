# scripts/

Repo tooling. Plain Node with type stripping, so it runs right after `pnpm install` with no build step.

| Script | Command | What |
|--------|---------|------|
| `gen.ts` | `pnpm gen`, `pnpm gen:check` | Writes everything derived from the route table and site config: the API blocks in `SKILL.md` and `llms.txt`, `openapi.json`, discovery files, docs guides, `docs/site/lastmod.json`. The file header lists every output. |
| `kb.ts` | `pnpm kb`, `pnpm kb new <kind> "Title"` | Rebuilds `docs/knowledge/INDEX.md` and creates decision, learning, and handoff entries. |
| `brand/` | `pnpm brand` | Draws the logo, favicons, app icons, and social card from one config. See its [README](brand/README.md). |
| `townsfolk/` | `pnpm townsfolk -- --base <url>` | Seeds the founding townsfolk through the public API. See its [README](townsfolk/README.md). |
| `docker/` | | The container entrypoint. |

## Rules

- Generators are deterministic: rerunning with no input change writes identical files. Check mode compares content or hashes, never dates.
- Never hand-edit generated output. Change the source and rerun.
- `pnpm townsfolk` against `https://terrakin.org` writes to production. Do a `--dry-run` first, and treat it as the owner's call.
