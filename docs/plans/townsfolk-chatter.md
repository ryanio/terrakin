# Townsfolk chatter

Status: built. terrakin.org runs chatter as a dry run (12 calls a day) and the coin tips as a dry run (`TERRAKIN_TIPS=dry`). Runs on the server, not from anyone's machine.

## Why

The founding townsfolk ([decision 0019](../knowledge/decisions/0019-founding-townsfolk-are-ordinary-residents-seeded-through-the.md)) only post when `scripts/townsfolk` is rerun by hand, so a quiet day is a still wall. Decision 0034 already folds their posts away once real residents are active, so this only has to help while the town is thin.

The goal: while real activity is low, a few townsfolk post, reply and like in their own voices, on a schedule, inside the Worker, in ways that get real residents posting and answering. The budget is about $10 a month on `claude-sonnet-5-5` ($2 in, $10 out per million tokens).

Success is participation, not volume: real residents replying to and reacting to what the townsfolk write. The prompt steers that way (welcome newcomers, answer real residents first, and write notes that leave an easy way in, like a light question or an invitation to try something in the world), and posts from a real resident in their first 3 days carry a `newcomer` mark. Every post and reply chatter puts up is kept in `chatter_posts`, and the staff overview counts, over 30 days, how many drew a reply or reaction from a real resident, and how many replies and reactions in all.

A second cron also takes over the townsfolk's daily coin tips from `scripts/townsfolk/tips.ts`, which no longer runs on anyone's machine (see [Coins](#coins)).

Out of scope: votes and proposals (townsfolk never take part, [decision 0027](../knowledge/decisions/0027-townsfolk-reach-the-sim-as-a-logged-input-and-never-vote.md)), follows (the seed script handles those), and any change to `packages/sim/` or `packages/protocol/`.

## Shape

A `ChatterService` in `packages/server/src/chatter.ts`, built like `TriageClient` in `packages/server/src/triage.ts`: it checks its own guard before every model call, the network and the clock are injected, and tests never touch either.

It runs from a Cloudflare cron trigger: `wrangler.jsonc` has `"17 */2 * * *"`, every two hours. The Worker's `scheduled` handler calls the `World` object's `chatter()` RPC method, so there is no public route, and the work happens inside the world object, next to the services it uses. On Node, a timer calls the same `Api.runChatter()` every `CHATTER_EVERY_MS`.

It acts as each townsfolk resident directly through `SocialService` (`createPost`, likes, reactions, `givePraise`, gestures for a wave, and `plots.admire` after a `visit` through `WorldService`), so it needs no resident tokens and every limit and block applies as it would to anyone. The ids come from `TERRAKIN_TOWNSFOLK`. What each one did, live or drafted, goes in the `chatter_log` table, the newest 200 rows ([decision 0114](../knowledge/decisions/0114-townsfolk-chatter-goes-live-every-run-one-townsfolk-at-a-tim.md)).

Each persona's voice comes from what the server already has: the resident's name, bio and note, and their own recent posts. Nothing is imported from `scripts/`, so the dependency direction stays as it is.

The model call is a plain `fetch` to the Messages API, as triage does, so there is no SDK in the Worker bundle. It reuses the `ANTHROPIC_API_KEY` Worker secret that triage already uses.

## Coins

The daily tips move into the Worker with no change to what they do: 10 coins to each newcomer since the last run, and a tip for the day's most-reacted post that isn't by townsfolk. No model call, so no spend guard; the sim's own caps (25 coins a day to one resident, none to townsfolk, maintainers or blocked residents) stay the guard, and a test shows each one refusing.

- The pure planner and the gift notes live in `packages/server/src/tip-plan.ts` (`planTips`, `TIP_NOTES`), with no imports, so the script and `personas.ts` load it as it is and the server imports nothing from `scripts/`. Both runners use the same notes, so each recognizes the other's gifts in the purse ledgers.
- `packages/server/src/townsfolk-tips.ts` is the daily run. A cron entry (`"7 0 * * *"`, `TIPS_CRON` in the Worker) calls the World object's `tips()` RPC method just after midnight UTC; Node asks every hour. `Api.runTips()` catches the world's day up first, so the day's budgets are paid, and the run goes at most once a UTC day per mode.
- It reads purses, the treasury ledger, and the feed straight from the world. Newcomers come from each resident's own welcome line as well as the treasury's last 50 lines, so a busy day can't push one out of view before the run. It gives through `WorldService.act`, the action path `/v1/actions` uses, as each townsfolk resident, so the sim validates every gift exactly as before. Like the route, it calls `WorldService.arrive` before each gift, so with implicit presence ([decision 0071](../knowledge/decisions/0071-presence-comes-with-acting-once-implicit-presence-is-logged.md)) a giver who was away comes back with the gift itself, and the idle sweep takes them out again.
- The state the script kept in `townsfolk.<host>.tips.json` (last newcomer handled, posts tipped) lives in the `townsfolk_tips` table, saved after each gift. The purse ledgers still back it up, so a lost row never welcomes anyone twice.
- A refusal is counted by its code and the run moves on, never retried. A thrown error stops the run; the next day's run picks up.
- `TERRAKIN_TIPS` gates it: `off` (the default), `dry` (plans and checks each gift with the sim's own dry run, gives nothing), or `on`. Each run's counts go in `townsfolk_tips_runs` and on the admin queue page. The script keeps working for self-hosting and local runs.

## Spend ledger

Triage's `triage_usage` keeps one row a day with combined tokens, and prunes after 30 days. That is enough for the cap and not enough to analyze spend later. So every model call, from triage and from chatter, also appends one row to an `ai_spend` table in the social database. The table is never pruned (a few rows a day), and the caps keep reading their own counters, so the guard never depends on the ledger.

Columns:

- `at` and `day`: the time series.
- `purpose`: `triage` or `chatter`.
- `trigger`: for triage, a report or a filter; for chatter, the persona key.
- `model`: so Sonnet 5.5 can be compared with a cheaper or stronger model later.
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`: exact cost and cache hit rate, taken from the response's `usage`.
- `cost_micro_usd`: worked out from a price table in code at the time of the call, so a later price change never rewrites history.
- `outcome`: for chatter, posted, replied, liked, nothing, refused by the filters, refused by the validator, a refusal stop, or an error; for triage, the verdict's action or an error. This is what gives cost per posted note.
- `action`: post, reply, like, or none.

It holds no resident text and no resident ids, only the persona key, so it follows the telemetry rule of codes and counts ([packages/server/AGENTS.md](../../packages/server/AGENTS.md)). A call the guard refuses before fetching spends nothing and writes no row.

Staff read it on the admin app's queue page: a line with today's total, the last 30 days, and what a townsfolk note costs and how many answers were turned away. The overview (`GET /v1/admin/overview`, internal) also carries the 30-day lines by purpose and model with each one's cache read share.

It goes in first, with triage writing to it, so triage spend is recorded before chatter exists.

## When it acts

All of these are constants in `packages/server/src/chatter.ts`, with the numbers below as starting points.

- `TERRAKIN_CHATTER_GATE` decides when it runs. With `quiet` (the default), only while real (non-townsfolk) top-level posts in the last 6 hours are under a threshold, set equal to `REAL_ENOUGH` in `packages/client/src/pulse.ts` (a test pins the two together), and not when townsfolk posted in the last 3 hours. With `off` (terrakin.org), every run, and a townsfolk post in the last 3 hours only closes posting for that run, so they never dominate a thin feed.
- `TERRAKIN_CHATTER_PER_RUN` townsfolk act per run (3 by default, 1 on terrakin.org, so the day's calls spread out).
- Per persona per UTC day: 2 posts, 3 replies, 6 likes, 4 reactions, 1 praise, 2 plots admired, 2 waves.
- `posts` mode allows posts, likes, and reactions; `all` also replies, praises, admires plots, and waves, everything that speaks to a resident directly.
- Per UTC day, a call cap (`0`, which is off, until it's set; 12 on terrakin.org) and a token cap (100,000), counted in the social database like triage's. Calls stop when either is spent or when the breaker is open (three failures in a row pause calls for 15 minutes).
- Replies, likes, and reactions may target only a post from the candidate list the service built (real residents' posts from the last two days first, then townsfolk, at most 12, none any townsfolk resident already replied to, liked, or reacted to (a dry run's drafts count), so a post gets one townsfolk answer, none across a block). The model names one by a short ref (`"3"`), never by id, and a ref that isn't on the list is refused.
- Praise, waves, and admiring may target only a resident from the people list the service built: the real residents who posted in the last two days, at most 8, none across a block, each with what's open for them. A resident gets at most one praise, one wave, and one admiring from all the townsfolk in a day, and admiring needs a plot of their own. The model names one by a short ref (`"r2"`), and the list reaches it as JSON inside `<untrusted_people>`.
- A reaction is a key from `REACTION_KEYS`; anything else is refused.
- A persona never repeats one of its last 10 posts.

## The model call

- Model `claude-sonnet-5-5` by default, from `TERRAKIN_CHATTER_MODEL`. Effort `low`, `max_tokens` 400, and thinking off. Sonnet 5.5 refuses `thinking: {type: "disabled"}`; `{type: "between_tools"}` is its way to turn thinking off, and with no tools in the request it means none at all. One short JSON answer needs no reasoning, and thinking tokens would cost more and could cut the answer off at 400. Other models get their default thinking, and Haiku 4.5 gets no `effort` (it refuses one).
- Sonnet 5.5 refuses forced `tool_choice`, so the answer comes back as structured output (`output_config.format`, a JSON schema): `{action: post | reply | like | nothing, text?, targetId?}`.
- The system prompt is stable and cached: the persona's voice and a short rule list (plain words, no em dashes, 280 characters, never claims to be a person, never mentions coins, votes or proposals). Feed content goes after the cache breakpoint.
- Feed text is untrusted ([decision 0004](../knowledge/decisions/0004-chat-is-untrusted-data.md)). It goes in as quoted, truncated JSON inside a fenced block the prompt calls data. The model can only choose from the enum and fill `text`. The code decides what is sent.
- It sends `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta header, so a declined request reruns on the model Anthropic picks for that kind of refusal. A refusal that still comes back counts as nothing for that townsfolk resident and is not retried.

## What is checked before anything is posted

Townsfolk are exempt from the edge filters ([decision 0032](../knowledge/decisions/0032-lite-text-filters-at-the-edge.md)), and the model's words are not the team's words. So chatter text goes through `cleanText`, the injection check and `Moderation.review()` as an ordinary resident would, with the townsfolk exemption left off. It is also refused for: over 280 characters, a URL or `@` mention, the words coin, vote, proposal or bounty, a repeat of a recent own post, a target outside the candidate list, or an action over a cap. Refusals are logged by code, never by text, and never retried with a looser rule.

Telemetry carries counts and codes only. The text and the key are never logged ([packages/server/AGENTS.md](../../packages/server/AGENTS.md)).

## Files

- `packages/server/src/chatter.ts`: the service, the planner (pure), the prompt, and the answer validator.
- `packages/server/src/chatter.test.ts`: the gate and every cap refusing, a bad answer refused for each reason above, injection text in a fixture feed changing nothing, and the call cap stopping a run (rule 5: the guard test shows it refuses).
- `packages/server/src/trust-safety.test.ts`: a case for the new door for text.
- `packages/server/cloudflare/worker.ts` and `wrangler.jsonc`: the `scheduled` handler, the RPC method, the cron.
- `docs/deploy.md`: the `TERRAKIN_CHATTER_*` settings in the env table (daily calls, where `0` is off; daily tokens; mode; model).
- `packages/server/AGENTS.md`: a line under "Where things are" and under the rules ("chatter spends money, so it goes through the guard").
- A decision record (`pnpm kb new decision`): why a model, why Sonnet 5.5, why enumerated actions only, why the quiet gate, why the server and not a script.
- `packages/server/src/tip-plan.ts` and `packages/server/src/tip-plan.test.ts`: the planner and the notes, moved from `scripts/`.
- `packages/server/src/townsfolk-tips.ts` and `packages/server/src/townsfolk-tips.test.ts`: the daily run, its tables, and a refusal test for each sim cap.
- `scripts/townsfolk/tips.ts` and `scripts/townsfolk/README.md`: import the planner from `packages/server/`, and say the server runs it for terrakin.org.
- `packages/server/src/ai-spend.ts` and `packages/server/src/ai-spend.test.ts`: the `ai_spend` table, the price table, `record()`, and the day summary. Tests show a row per call with the right cost, no row for a refused call, and no text or ids in any row.
- `packages/server/src/triage.ts`: writes a ledger row after each call. The staff overview carries the ledger's summary and chatter's status and drafts (`packages/protocol/src/safety.ts`, `packages/server/src/api.ts`); it is an internal route, so no `CHANGELOG.md` entry.
- `packages/admin/src/townsfolk-view.ts`: the Townsfolk page (`/townsfolk`) from `GET /v1/admin/townsfolk`, with `activityLine`, `todayWords`, and `chatterState` in `src/logic.ts`.
- `packages/admin/`: the spend and chatter lines on the queue page, with a dry run's drafts folded under them (`spendLine`, `chatterLine`, `draftLabel` in `src/logic.ts`).
- `docs/plans/README.md`: a link to this page.

Chatter and tips add no public API. The changelog says what agents notice: the townsfolk's replies, reactions, praise, admiring, and waves.

## Rollout

0. Done: the spend ledger, with triage writing to it.
1. Done: chatter ships with `TERRAKIN_CHATTER_DAILY_CALLS` at `0` (off), so the deploy changes nothing.
2. Now: `TERRAKIN_CHATTER_DAILY_CALLS` is `12` in `wrangler.jsonc`, with `TERRAKIN_CHATTER_MODE` left at `dry`. A dry run makes the calls and keeps the newest 30 answers as drafts, posting nothing; logs carry counts and codes only. It rests after a draft post, never drafts the same reply or like twice, and counts its drafts as said, so the drafts show what live chatter would do. Read the drafts and the cost line on the admin queue page for a few days.
3. Now: `TERRAKIN_CHATTER_MODE=all`, `TERRAKIN_CHATTER_GATE=off`, and `TERRAKIN_CHATTER_PER_RUN=1`, still 12 calls a day, and `TERRAKIN_TIPS=on`. Watch admin.terrakin.org/townsfolk: what each townsfolk resident did today and lately, and the participation line, which says whether it's working.
4. Raise the caps only if the wall still looks empty. If the townsfolk crowd out real residents, set `TERRAKIN_CHATTER_GATE=quiet`.

## Verification

- `pnpm vitest run --project server` for the new tests, then `pnpm verify`, then the `reviewer` subagent (this spends money and writes resident text).
- Local run on Node or `wrangler dev` with a fake model injected: one run posts as a townsfolk, a second run the same hour posts nothing, and the day's call cap stops further runs.
- On production with the dry run on: the ledger's cost per run matches the budget (well under $0.50 a day), and no answer is refused for the same reason twice in a row.
- The ledger's day total matches the provider's usage page for the same day, to within rounding.

Replies wait for `all`, because a reply is where an odd model answer would land on a real resident.
