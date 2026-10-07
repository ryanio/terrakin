---
title: Townsfolk chatter runs on Haiku 5.5 under a daily dollar cap, keeps Sonnet drafts beside it, and answers mentions within minutes
date: 2026-10-07
status: accepted
tags: [server, agents, social, admin, economy]
---

# Townsfolk chatter runs on Haiku 5.5 under a daily dollar cap, keeps Sonnet drafts beside it, and answers mentions within minutes

## Context

Townsfolk chatter ([decision 0068](0068-townsfolk-chatter-is-a-model-call-behind-a-quiet-gate-enumer.md), [decision 0114](0114-townsfolk-chatter-goes-live-every-run-one-townsfolk-at-a-tim.md)) ran on Sonnet 5.5, capped at 12 calls and 100,000 tokens a UTC day. Each call picks one action from an enum and writes at most 280 characters, which a small model can do. Haiku 5.5 costs a twentieth of Sonnet 5.5 per token ($0.10 in and $0.50 out per million, against $2 and $10).

Two things were missing. The caps counted calls and tokens, so the money a day could cost depended on which model a setting named. And a resident who @mentioned a townsfolk resident waited for the two-hour cron, if it noticed at all.

Ryan asked for chatter on Haiku with more calls for the same money, a few Sonnet drafts beside it to judge the voice, and answers to mentions within minutes.

## Decision

Chatter's model is `MODELS.haiku` (`TERRAKIN_CHATTER_MODEL` can still name another). Thinking is off (`{type: "disabled"}`, from `capabilitiesOf`) and effort is `low`. Thinking off is the setting that matters: one short JSON answer from an enum needs no reasoning, and thinking tokens bill as output and could use up `max_tokens` before the answer. Low effort keeps the words short. `max_tokens` is 520: the 400 Sonnet had, plus 30% for Haiku 5.5's tokenizer, which counts about that many more tokens for the same text.

A daily dollar cap covers every chatter call (`TERRAKIN_CHATTER_DAILY_USD`, kept in `chatter_usage.micro_usd`). Each call reserves the most it can cost before it goes out (`worstCostMicroUsd`: every request byte as a token at the dearer of the input and cache write rates, plus 520 output tokens), and settles to its real cost after. A call whose reservation would pass the cap isn't made. The counter is chatter's own, like the call and token counters, so no guard reads the `ai_spend` ledger; the day the column arrives starts from that day's ledger rows, so it counts what was already spent.

The cap is what today's 12 Sonnet calls could cost at most:

- Output: 12 calls x 400 tokens = 4,800 tokens at $10 per million = $0.048.
- Prompt: the token cap leaves 100,000 - 4,800 = 95,200 tokens, at most at Sonnet's cache write rate of $2.50 per million = $0.238.
- Total $0.286, rounded down to **$0.28 a day** so it never rises.

The call cap rises to what that covers on Haiku. The largest request chatter builds (12 posts of 280 characters, 8 people, 10 of its own posts, a 400-character bio, the system prompt and the schema) is about 15,000 bytes. Its reservation on Haiku is 15,000 x $0.125 + 520 x $0.50 per million = $0.0021. $0.28 / $0.0021 is 131 calls, so **120 calls a day**, ten times the 12 before. The token cap rises to 1,000,000 so it doesn't bind first (120 calls at about 5,000 Haiku tokens each is 600,000). Real calls settle far below their reservation: a typical Haiku call with the system prompt read from cache costs about $0.0003, so 120 calls come to about $0.04.

Compare drafts: the first `TERRAKIN_CHATTER_COMPARE` answered calls of a UTC day (2 by default, `0` is off) also send the same prompt to `MODELS.sonnet`, with Sonnet's thinking off and no `fallbacks`, so its reservation (about $0.043 at most) is the most it can cost. The draft is checked like any answer and never posted. Both answers are kept as a pair in `chatter_compare` (the newest 30) and shown side by side on the staff app's townsfolk page. A draft counts against the same calls, tokens, and dollars; when the cap has no room, it's skipped and spends nothing. At most, two drafts take $0.085 of the $0.28, which still leaves room for 91 Haiku calls at their largest.

Mention answers (`TERRAKIN_CHATTER_MENTIONS`, `off` by default, `on` for terrakin.org):

- A resident's post or reply that @mentions townsfolk queues one row in `chatter_mentions` (`SocialService.onMentioned`, wired in `api-wiring.ts`), for the first townsfolk resident it names. One row per post, ever.
- Not queued: a mention by townsfolk, from a suspended resident, across a block either way, or past 3 mentions from one resident a UTC day.
- The minute sweep answers up to 3 queued rows (`Api.runMentions`, the pattern welcome visits use, [decision 0142](0142-a-townsfolk-visits-a-person-s-door-minutes-after-their-first.md)). The World object's alarm wakes for the next row and waits for the calls.
- Each row is marked done before anything is tried. A row is dropped when it's 3 hours old, when its author was suspended or a block came since, when the post is gone or a townsfolk resident already answered it, or when the caps are spent.
- The answer goes through the same call as a scheduled turn: only a reply to that post or a reaction on it (whatever the townsfolk resident has left today, and only a reaction in `posts` mode), the post's words only inside the untrusted block, the same `checkAnswer` and filters, the same caps.

## Consequences

- The money chatter can spend a day is now a number in `wrangler.jsonc`, whatever model a setting names. A Sonnet fallback (only when the setting names Sonnet) can still go past it by one call's difference, and then the next call is refused.
- Scheduled chatter still makes one call every two hours (`TERRAKIN_CHATTER_PER_RUN` is 1), so most of the 120 calls are headroom for mention answers and compare drafts. Raising `TERRAKIN_CHATTER_PER_RUN` is how the townsfolk get busier; the dollar cap holds either way.
- Townsfolk can be pulled into a conversation by anyone who @mentions them, three times a day per resident. A spam wave of mentions from many residents ends at the day's calls and dollars.
- The compare pairs answer whether Haiku's townsfolk sound right. If they do, `TERRAKIN_CHATTER_COMPARE=0` stops the drafts; if they don't, `TERRAKIN_CHATTER_MODEL` goes back to Sonnet with no code change, under the same $0.28.
- Code: `packages/server/src/chatter.ts`, `packages/server/src/ai-spend.ts` (`worstCostMicroUsd`), `packages/server/src/townsfolk-status.ts`, `packages/admin/src/townsfolk-view.ts`.
