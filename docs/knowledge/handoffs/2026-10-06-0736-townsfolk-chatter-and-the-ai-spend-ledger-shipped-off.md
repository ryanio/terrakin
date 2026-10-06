---
title: Townsfolk chatter, coin tips, and the AI spend ledger, live as dry runs
date: 2026-10-06
tags: [server, agents, social, admin, economy]
---

# Townsfolk chatter, coin tips, and the AI spend ledger, live as dry runs

## Done

- [Townsfolk chatter](../../plans/townsfolk-chatter.md) is built ([decision 0068](../decisions/0068-townsfolk-chatter-is-a-model-call-behind-a-quiet-gate-enumer.md)). `server/src/chatter.ts` runs from a cron every two hours (`wrangler.jsonc`, the World object's `chatter()` RPC method; a timer on Node).
  - It acts only while real residents are posting little.
  - At most 3 townsfolk act per run, one Sonnet 5.5 call each, with thinking off (`between_tools`), low effort, structured output, and `fallbacks: "default"`.
  - The model picks post, reply, like, or nothing, and names posts by ref. `checkAnswer` and the edge filters check every word before `createPost`.
- The AI spend ledger (`server/src/ai-spend.ts`, the `ai_spend` table). Triage and chatter write one row per call that went out.
- The admin queue page has a spend line, a chatter line, a participation line (how many townsfolk notes drew a reply or reaction from a real resident), and a dry run's drafts folded under them.
- The townsfolk's daily coin tips moved from the laptop script into the server: `server/src/tip-plan.ts` (the planner and each townsfolk's notes, shared with `scripts/townsfolk/tips.ts`) and `server/src/townsfolk-tips.ts` (the run, from a second cron just after midnight UTC, at most once a day, `TERRAKIN_TIPS`). Every gift goes through `WorldService.act` as the townsfolk resident, so the sim's caps decide. Each gift calls `WorldService.arrive` first, as `/v1/actions` does, so with implicit presence (decision 0071) an away giver comes back with the gift and the idle sweep takes them out.
- Success is participation. The prompt steers toward welcoming newcomers (marked in the feed it sees), answering real residents, and notes that invite an answer.

## State of things

- Chatter runs on terrakin.org as a dry run: `TERRAKIN_CHATTER_DAILY_CALLS=12` and `TERRAKIN_CHATTER_MODE=dry` in `wrangler.jsonc`. Calls go out, the newest 30 answers are kept as drafts for staff, and nothing is posted.
- Tips run as a dry run too (`TERRAKIN_TIPS=dry`): each day's gifts are checked with the sim and nothing is given. Nothing else gives tips on terrakin.org now.
- `pnpm verify` is green, and the admin e2e spec passes.

## Next

1. Read the drafts and the spend line on admin.terrakin.org after a day or two. At 12 calls a day the worst case is about $0.11 a day. The Worker logs one `Chatter: <result>` line per run (codes only).
2. Then set `TERRAKIN_CHATTER_MODE` to `posts` in `wrangler.jsonc`, and `all` (replies) after a few days of clean posts. From then on, the participation line is the number to watch.
3. After two days of the tips line on the admin queue page looking right (compare with `pnpm townsfolk:tips -- --base https://terrakin.org`, which only prints), set `TERRAKIN_TIPS` to `on` in `wrangler.jsonc`.

## Open questions

- Ryan: when to go from the dry runs to `posts` (chatter) and `on` (tips). Both reach real residents: posts and likes on the wall, and coins with a note.
