---
title: Townsfolk chatter and the AI spend ledger, live as a dry run
date: 2026-10-06
tags: [server, agents, social, admin, economy]
---

# Townsfolk chatter and the AI spend ledger, live as a dry run

## Done

- [Townsfolk chatter](../../plans/townsfolk-chatter.md) is built ([decision 0068](../decisions/0068-townsfolk-chatter-is-a-model-call-behind-a-quiet-gate-enumer.md)). `server/src/chatter.ts` runs from a cron every two hours (`wrangler.jsonc`, the World object's `chatter()` RPC method; a timer on Node).
  - It acts only while real residents are posting little.
  - At most 3 townsfolk act per run, one Sonnet 5.5 call each, with thinking off (`between_tools`), low effort, structured output, and `fallbacks: "default"`.
  - The model picks post, reply, like, or nothing, and names posts by ref. `checkAnswer` and the edge filters check every word before `createPost`.
- The AI spend ledger (`server/src/ai-spend.ts`, the `ai_spend` table). Triage and chatter write one row per call that went out.
- The admin queue page has a spend line, a chatter line, a participation line (how many townsfolk notes drew a reply or reaction from a real resident), and a dry run's drafts folded under them.
- Success is participation. The prompt steers toward welcoming newcomers (marked in the feed it sees), answering real residents, and notes that invite an answer.

## State of things

- Chatter runs on terrakin.org as a dry run: `TERRAKIN_CHATTER_DAILY_CALLS=12` and `TERRAKIN_CHATTER_MODE=dry` in `wrangler.jsonc`. Calls go out, the newest 30 answers are kept as drafts for staff, and nothing is posted. `pnpm verify` is green, and the admin e2e spec passes.
- The coin tips still run from `scripts/townsfolk/tips.ts` by hand. Moving them into the Worker is the unbuilt part of the plan.

## Next

1. Read the drafts and the spend line on admin.terrakin.org after a day or two. At 12 calls a day the worst case is about $0.11 a day. The Worker logs one `Chatter: <result>` line per run (codes only).
2. Then set `TERRAKIN_CHATTER_MODE` to `posts` in `wrangler.jsonc`, and `all` (replies) after a few days of clean posts. From then on, the participation line is the number to watch.
3. Move the coin tips into the Worker: the plan's [Coins](../../plans/townsfolk-chatter.md#coins) section lists the files (`server/src/townsfolk-tips.ts`, a daily cron entry, a state table, `TERRAKIN_TIPS_ON`).

## Open questions

- Ryan: when to go from the dry run to `posts`.
