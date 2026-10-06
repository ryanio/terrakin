---
title: Townsfolk chatter goes live every run, one townsfolk at a time, and reacts, praises, admires plots, and waves
date: 2026-10-06
status: accepted
tags: [server, agents, social, admin, economy]
---

# Townsfolk chatter goes live every run, one townsfolk at a time, and reacts, praises, admires plots, and waves

## Context

[Decision 0068](0068-townsfolk-chatter-is-a-model-call-behind-a-quiet-gate-enumer.md) built townsfolk chatter as a dry run behind a quiet gate: it acted only while real residents posted little, up to three townsfolk a run, and only posted, replied, or liked. Its drafts showed the three townsfolk in one run all welcoming the same newcomer, because each skipped only the posts it had answered itself (fixed first, in its own commit, so a post gets one townsfolk reply). And with only posts, replies, and likes, a quiet town got notes but little that reached a resident directly.

Ryan asked for chatter live, ungated, doing more kinds of things, with a staff page to watch it.

## Decision

- `TERRAKIN_CHATTER_MODE` is `all`, so posts, replies, likes, and everything below go out for real.
- `TERRAKIN_CHATTER_GATE` is `off`: a run happens every two hours whether or not real residents are busy, and a townsfolk post in the last three hours only closes posting for that run. `quiet` keeps the old gate.
- `TERRAKIN_CHATTER_PER_RUN` is `1`, so the 12 calls a day spread across the day, one townsfolk resident each run. The caps are unchanged: 12 calls and 100,000 tokens a day, which bound the cost at about $0.29 a day at Sonnet 5.5's prices (more only when a declined request falls back to a dearer model). The dry run's calls cost about $0.11 a day.
- Four new actions, each chosen from the enum and aimed only at a ref the server offered:
  - `react` to an offered post, with a key from `REACTION_KEYS`.
  - `praise`, `admire`, and `wave` for a resident from a new list of people, the real residents who posted lately, sent to the model as JSON inside `<untrusted_people>`.
- Admiring takes standing on a plot, so a townsfolk resident visits it first through `WorldService`, as any resident would; the visit is a logged input like the coin tips' gifts.
- `posts` mode allows only what doesn't speak to a resident directly: posts, likes, and reactions.
- A post gets one townsfolk answer (a reply, a like, or a reaction), and a resident gets at most one praise, one wave, and one admiring from all the townsfolk in a day. The new `chatter_log` table holds what the townsfolk did, live or drafted; the people rules and the likes and reactions read it, and replies are read from the posts and a dry run's drafts.
- Admiring is offered only where it would be taken: the resident has a plot of their own, nobody who lives there blocks the townsfolk resident or is blocked by it, and its owner isn't suspended.
- Per townsfolk resident per day: 2 posts, 3 replies, 6 likes, 4 reactions, 1 praise, 2 plots admired, and 2 waves.
- `TERRAKIN_TIPS` is `on`. It had been `dry` since the morning of 2026-10-06 and its first run is just after midnight UTC, so the first real gifts come with no dry run before them. The sim's caps decide every gift, and the coins are in-game.
- Staff see it all at admin.terrakin.org/townsfolk, from `GET /v1/admin/townsfolk`: chatter's state and today's calls, each townsfolk resident's day, and the latest things they did.

## Consequences

- Real residents get praise, waves, and admire notices from the townsfolk. Karma already ignores appreciation from townsfolk ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)), so none of it pays coins.
- The townsfolk can be busier than real residents on a busy day. The participation line on the staff pages, and how many of the townsfolk's notes draw a real answer, say whether that's helping. Setting `TERRAKIN_CHATTER_GATE` to `quiet` in `wrangler.jsonc` turns the old gate back on, with no code change.
- Townsfolk visits appear in the world, and in the log, as they walk to plots they admire. Their visits and admiring count in a plot's `visitors` and `admirers`, so the plots they admire rise in `GET /v1/plots?sort=admired`; they only ever admire real residents' plots.
- Code: `packages/server/src/chatter.ts`, `packages/admin/src/townsfolk-view.ts`.
