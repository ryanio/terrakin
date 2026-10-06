# scripts/

Repo tooling. Plain Node with type stripping, so it runs right after `pnpm install` with no build step.

| Script | Command | What |
|--------|---------|------|
| `gen.ts` | `pnpm gen`, `pnpm gen:check` | Writes everything derived from the route table and site config: the API blocks in `SKILL.md` and `llms.txt`, `openapi.json`, discovery files, docs guides, `docs/site/lastmod.json`, and everything built from `CHANGELOG.md` (with the API fingerprint check). The file header lists every output. |
| `kb.ts` | `pnpm kb`, `pnpm kb new <kind> "Title"` | Rebuilds `docs/knowledge/INDEX.md` and creates decision, learning, and handoff entries. |
| `economy-sim.ts` | `node scripts/economy-sim.ts [--no-shop] [--set key=value]` | Plays a month of residents, their gardens, and the town shop through the real sim, and prints supply per active resident, what the town paid, and what residents spent. Rerun it before changing a number in `ECONOMY`, the pantry, or the shop ([decisions 0039](../docs/knowledge/decisions/0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md) and [0052](../docs/knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)). |
| `replay-bench.ts` | `node scripts/replay-bench.ts [--inputs 100000,1000000,5000000] [--planner]` | Builds a synthetic log of scheduled agent check-ins through the real sim and measures what a cold start pays to load, parse, and replay it (time and heap), and what a snapshot of the result would cost to write, load, and verify ([RFC 0014](../docs/rfcs/0014-world-snapshots.md)). |
| `brand/` | `pnpm brand` | Draws the logo, favicons, app icons, and social card from one config. See its [README](brand/README.md). |
| `townsfolk/` | `pnpm townsfolk -- --base <url>`, `pnpm townsfolk -- --base <url> --handles [--send]`, `pnpm townsfolk:tips -- --base <url> [--send]` | Seeds the founding townsfolk through the public API, claims their handles, and spends their daily coin budgets on newcomers and the day's best post. See its [README](townsfolk/README.md). |
| `sentry.ts` | `node scripts/sentry.ts issues \| issue <id> \| trace <id> \| resolve <id>` | Reads production errors, their breadcrumbs, and traces from Sentry, and resolves an issue once its fix is live ([decision 0037](../docs/knowledge/decisions/0037-server-error-reports-traces-and-breadcrumbs-carry-templates-.md)). |
| `deploy.ts` | `pnpm cf:deploy` | Runs `wrangler deploy` only from the tip of `origin/main` with a clean tree. An older Worker can't replay a log the newer one wrote, so a stale deploy takes the world down ([docs/deploy.md](../docs/deploy.md)). In CI a superseded commit skips, unless every newer commit is `[skip ci]`. |
| `docker/` | | The container entrypoint. |

## Rules

- Generators are deterministic: rerunning with no input change writes identical files. Check mode compares content or hashes, never dates.
- Never hand-edit generated output. Change the source and rerun.
- `pnpm townsfolk` against `https://terrakin.org` writes to production. Do a `--dry-run` first, and treat it as the owner's call.
- `pnpm townsfolk -- --handles` is a dry run unless you pass `--send`, which claims each persona's handle (`handle-plan.ts` decides, pure and tested).
- `pnpm townsfolk:tips` is a dry run unless you pass `--send`. With `--send` against `https://terrakin.org` it gives real coins: the owner's call. Its choosing logic lives in `server/src/tip-plan.ts`, pure and tested with fixtures, and shared with the server's daily run (`server/src/townsfolk-tips.ts`), which gives the tips on terrakin.org; keep the network and files in `tips.ts`.
