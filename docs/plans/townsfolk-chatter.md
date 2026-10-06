# Townsfolk chatter

Status: proposed. Runs on the server, not from anyone's machine.

## Why

The founding townsfolk ([decision 0019](../knowledge/decisions/0019-founding-townsfolk-are-ordinary-residents-seeded-through-the.md)) only post when `scripts/townsfolk` is rerun by hand, so a quiet day is a still wall. Decision 0034 already folds their posts away once real residents are active, so this only has to help while the town is thin.

The goal: while real activity is low, a few townsfolk post, reply and like in their own voices, on a schedule, inside the Worker. The budget is about $10 a month on `claude-sonnet-5-5` ($2 in, $10 out per million tokens).

Out of scope: coins (they stay in `scripts/townsfolk/tips.ts`), votes and proposals (townsfolk never take part, [decision 0027](../knowledge/decisions/0027-townsfolk-reach-the-sim-as-a-logged-input-and-never-vote.md)), follows (the seed script handles those), and any change to `sim/` or `protocol/`.

## Shape

A `ChatterService` in `server/src/chatter.ts`, built like `TriageClient` in `server/src/triage.ts`: it checks its own guard before every model call, the network and the clock are injected, and tests never touch either.

It runs from a Cloudflare cron trigger. `wrangler.jsonc` gets a `triggers.crons` entry (every two hours to start). The Worker's new `scheduled` handler calls an RPC method on the `World` object, so there is no public route. The work happens inside the world object, next to the services it uses.

It acts as each townsfolk resident directly through `SocialService` (`createPost`, likes, replies), so it needs no resident tokens. The ids come from `TERRAKIN_TOWNSFOLK`.

Each persona's voice comes from what the server already has: the resident's name, bio and note, and their own recent posts. Nothing is imported from `scripts/`, so the dependency direction stays as it is.

The model call is a plain `fetch` to the Messages API, as triage does, so there is no SDK in the Worker bundle. It reuses the `ANTHROPIC_API_KEY` Worker secret that triage already uses.

## When it acts

All of these are constants in `server/src/chatter.ts`, with the numbers below as starting points.

- It runs only while real (non-townsfolk) top-level posts in the last 6 hours are under a threshold, set equal to `REAL_ENOUGH` in `client/src/pulse.ts` (a test pins the two together).
- It skips a run if townsfolk already posted in the last 3 hours, so they never dominate a thin feed.
- Per persona per UTC day: 2 posts, 3 replies, 6 likes. Per run: at most 3 personas act.
- Per UTC day, a call cap (24) and a token cap, counted in the social database like triage's. Calls stop when either is spent or when the breaker is open (three failures in a row pause calls for 15 minutes).
- Replies and likes may target only a post id from the candidate list the service built (real residents' recent posts first, then townsfolk). A made-up id is refused.
- A persona never repeats one of its last 10 posts.

## The model call

- Model `claude-sonnet-5-5` by default, from `TERRAKIN_CHATTER_MODEL`. Effort `low`, `thinking` left out, `max_tokens` about 400.
- Sonnet 5.5 refuses forced `tool_choice`, so the answer comes back as structured output (`output_config.format`, a JSON schema): `{action: post | reply | like | nothing, text?, targetId?}`.
- The system prompt is stable and cached: the persona's voice and a short rule list (plain words, no em dashes, 280 characters, never claims to be a person, never mentions coins, votes or proposals). Feed content goes after the cache breakpoint.
- Feed text is untrusted ([decision 0004](../knowledge/decisions/0004-chat-is-untrusted-data.md)). It goes in as quoted, truncated JSON inside a fenced block the prompt calls data. The model can only choose from the enum and fill `text`. The code decides what is sent.
- It sends the server-side `fallbacks` setting that Sonnet 5.5 code is meant to include. A refusal counts as "nothing" for that persona and is not retried.

## What is checked before anything is posted

Townsfolk are exempt from the edge filters ([decision 0032](../knowledge/decisions/0032-lite-text-filters-at-the-edge.md)), and the model's words are not the team's words. So chatter text goes through `cleanText`, the injection check and `Moderation.review()` as an ordinary resident would, with the townsfolk exemption left off. It is also refused for: over 280 characters, a URL or `@` mention, the words coin, vote, proposal or bounty, a repeat of a recent own post, a target outside the candidate list, or an action over a cap. Refusals are logged by code, never by text, and never retried with a looser rule.

Telemetry carries counts and codes only. The text and the key are never logged ([server/AGENTS.md](../../server/AGENTS.md)).

## Files

- `server/src/chatter.ts`: the service, the planner (pure), the prompt, and the answer validator.
- `server/src/chatter.test.ts`: the gate and every cap refusing, a bad answer refused for each reason above, injection text in a fixture feed changing nothing, and the call cap stopping a run (rule 5: the guard test shows it refuses).
- `server/src/trust-safety.test.ts`: a case for the new door for text.
- `server/cloudflare/worker.ts` and `wrangler.jsonc`: the `scheduled` handler, the RPC method, the cron.
- `docs/deploy.md`: the new `TERRAKIN_CHATTER_*` settings in the env table (on, model, daily calls, daily tokens, cadence note).
- `server/AGENTS.md`: a line under "Where things are" and under the rules ("chatter spends money, so it goes through the guard").
- A decision record (`pnpm kb new decision`): why a model, why Sonnet 5.5, why enumerated actions only, why the quiet gate, why the server and not a script.
- `docs/plans/README.md`: a link to this page.

Not needed: a `CHANGELOG.md` entry, since no API changes.

## Rollout

1. Ship with `TERRAKIN_CHATTER_DAILY_CALLS` at `0` (off), so the deploy changes nothing.
2. Add a dry-run mode that runs the planner and the model but stores and posts nothing, and logs only counts. Run it a few times on production and read the answers through a staff-only summary.
3. Turn posts and likes on first, replies after a few days of clean output.
4. Raise the caps only if the wall still looks empty.

## Verification

- `pnpm vitest run --project server` for the new tests, then `pnpm verify`, then the `reviewer` subagent (this spends money and writes resident text).
- Local run on Node or `wrangler dev` with a fake model injected: one run posts as a townsfolk, a second run the same hour posts nothing, and the day's call cap stops further runs.
- On production with the dry run on: the cost estimate per run matches the budget (well under $0.50 a day), and no answer is refused for the same reason twice in a row.

## Open question

Posts and likes only at first, or replies from day one? The plan stages replies later, because a reply is where an odd model answer would land on a real resident.
