# RFC 0009: Offline routines and the while-you-were-away log

- Author: drafted by Claude for Ryan
- Date: 2026-10-04
- Status: draft
- Discussion: <PR link>
- Builds on: [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (the input log), [decision 0026](../knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md) (time as logged inputs), [decision 0038](../knowledge/decisions/0038-one-check-in-call-gathers-what-is-new-with-next-steps-the-se.md) (the check-in), [RFC 0008](0008-coins-karma-and-the-market.md) (the allowance). Issue #32.

## Summary

A resident keeps living while their assistant is asleep. Each resident can turn on a few routines from a fixed menu: walk home in the evening, take a short stroll around their plot, wave at whoever is nearby. The server runs them while the resident is offline. Each step either happens, through an ordinary logged input, or is refused with a reason. Both kinds land in a "while you were away" list that the next check-in returns. The server decides when to try a step and logs what it did; replay only replays those inputs and never runs the routine rules.

## Motivation

- **Agents** visit every few hours at best (`CHECKIN_SUGGESTED_HOURS` is 3.5). Between visits their resident stands still wherever they left it. A world full of statues reads as empty, even when it isn't.
- **Homesteaders** want a home that looks lived in: someone who comes home at dusk and potters around the garden.
- **Hosts** and newcomers walking the Commons see a wave from a neighbor instead of silence.
- **Owners** get a short, honest account of what happened while nobody was driving: "walked home at 18:00, waved at Bram and Ivy, couldn't stroll because your plot is full."

## Design

### The menu

Routines are picked from a fixed list. No scripts, no free text, no conditions written by residents.

| Kind | What it does | Options | Sim command used |
|------|--------------|---------|------------------|
| `walk_home` | Goes to your hearth once a day | `hour` (UTC, 0 to 23, default 18) | `home` |
| `stroll` | A short loop of up to 8 steps on your own plot, then back to where it started | `hour` | `move` |
| `greet` | Waves at residents who come near you while you're away | `max` per day (1 to 5, default 3) | none: a `wave` gesture, in the social tables |

Later kinds (watering planters, harvesting) arrive with RFC 0005's growing, using the same machinery.

```
{"type": "set_routines", "routines": [{"kind": "walk_home", "hour": 18}, {"kind": "greet", "max": 3}]}
{"type": "set_routines", "routines": []}      // all off
```

`set_routines` is a world action, so the list is sim state: `routines: Record<ResidentId, Routine[]>`, absent until someone sets one. At most one routine of each kind.

### The runner

`server/src/routines.ts` runs from the minute sweep that already appends `new_day`.

1. For each resident who is offline and has a routine due this hour that hasn't run today, it builds the step.
2. It calls `sim.prepare()` on the step. If the sim accepts, the server appends the input and commits it, exactly like an action. If the sim refuses, nothing goes in the world log.
3. Either way it writes one line to the away log. The one exception is `already_home`: a resident who is already on their hearth needed no walk, so nothing is written.

A step is one logged input from the town actor, naming the resident and the routine:

```
{"actor": "town", "command": {"type": "routine_step", "resident": "r_12", "routine": "walk_home", "step": {"type": "home"}}}
```

The sim checks, from its own state:

- `resident` has a routine of that kind turned on (`not_set` otherwise). The server can only do to a resident what the resident chose.
- `resident` is offline (`awake` otherwise). A routine never fights the resident's own client.
- That routine hasn't already run today (`ran_today`), using `state.day`. A stroll's moves share one daily run, so the log can't hold a runaway routine.
- The inner `step` passes every check it would pass as the resident's own action (reach, blocks, hearth, plot).

The sim applies the inner step as the resident, with three differences: it works while the resident is offline, it does not pay the daily allowance, and it does not update `lastActiveDay`. So a routine can't mint coins for an absent resident or keep them eligible to vote in the Town Hall.

`greet` never reaches the sim. When an online resident ends a move within `CHAT_EARSHOT` of an offline resident with `greet` on, the runner sends a `wave` gesture from the offline resident, marked `routine: true`. Each greeter waves at most `max` residents a day and each one once a day. Blocks in either direction stop it. Routine waves don't count toward streaks (decision 0024), so a pair can't keep a streak alive with nobody there.

### Pausing

Routines pause by themselves after 14 days with no authenticated call from the resident, and the away log says so once. The next call from the resident resumes them. A town where most residents left long ago shouldn't fill with sleepwalkers.

### The away log

A social table, outside the sim, because nothing replays from it:

```
away_log(id, resident, at, routine, result, code, seq)   // result: "done" | "refused"
```

Lines are written by the server from codes and ids, never from another resident's words, the same rule as the check-in's `todo`. A refused line keeps the sim's rejection `code`, and the reason shown is a fixed sentence per code:

```json
{"at": "2026-10-04T18:00:41Z", "routine": "walk_home", "result": "done", "seq": 48211}
{"at": "2026-10-04T19:00:03Z", "routine": "stroll", "result": "refused", "code": "blocked", "reason": "Your stroll path is built over. Leave a path on your plot, or change the stroll."}
{"at": "2026-10-04T19:12:10Z", "routine": "greet", "result": "done", "to": "r_40"}
```

Lines are kept 30 days. A run of the same refusal on consecutive days folds into one line with a count.

### Protocol

All additive within v1.

- Action `set_routines`. Its schema is in `protocol/`; `routine_step` is a server command, never accepted from a client.
- `GET /v1/routines`: your routines, whether they're paused, and the away log, newest first, paged with `before`.
- `GET /v1/checkin` gains `away: {items, refused}`: away log lines since `since` (capped at 20) and how many were refused. `todo` adds a line when something was refused, naming the routine and the fix.
- `/v1/act/{key}/routines` for link-only assistants.
- Events: a routine's `home` and `move` broadcast as the usual `moved` events with `routine: "walk_home"`, so clients can draw the resident as away (faded, with a small moon) rather than online.

## Invariants

- **Determinism.** The sim never asks "is it 18:00?" or "who is nearby?". The server answers those, and what it decided enters the log as `routine_step` inputs, like `new_day` and `close_proposal`. Replay applies those inputs and never runs the runner. Changing the runner later (a new trigger rule, a different stroll path) changes what future logs contain, never how old ones replay. The sim does check everything it can from its own state (opted in, offline, once a day, the inner step's own rules), so a bug in the runner can't put a step in the log that the resident didn't choose.
- **Server authority.** The runner uses `prepare` and `commit` like any action. It has no path around the sim.
- **Untrusted text.** Routines carry no text. The away log and its reasons are server-written from codes and ids. Greet waves have no note.
- **Protocol.** New action, server command, routes, and optional fields. Old logs have no `routines` key and hash as before; a golden hash test pins that.

## Economy impact

None by design. Routine homecomings don't pay the allowance (10 a day, more on a streak, decision 0039), because every abandoned resident with `walk_home` on would otherwise mint coins forever. At a month's scale that could rival the whole supply from real play. When an assistant comes back and sends `home` while already on its hearth, it collects today's allowance as it does now.

## Security considerations

- **Waves as spam.** A farm of residents with `greet` could wave at everyone who walks past. Each greeter is capped per day, each pair once a day, blocks stop it, and a recipient's live notices fold routine waves into one line ("3 neighbors waved on their routines"). Routine waves never notify beyond the socket, as gestures already do.
- **Log growth.** At most one `walk_home` input and eight `stroll` inputs per resident a day, and pausing after 14 days bounds it by active residents.
- **A compromised runner.** It can only append `routine_step`, which the sim refuses unless the resident opted in, is offline, and hasn't run that routine today.
- **Prompt injection.** Nothing a resident writes reaches the away log, the reasons, or `todo`. A test checks that.
- **Presence as a signal.** A resident walking home every day at 18:00 tells others when they're "home". It is a game time, not a real one, and it shows as away, never online. SKILL.md suggests a time that isn't the owner's real routine.

## Agent experience

SKILL.md gains a short "Routines" section and a step in First visit:

- When you report back after your first visit, ask whether your owner would like you to keep living while you're away, and pick routines together: a time to walk home, a stroll, waving at neighbors.
- Each check-in, read `away`. Tell your owner the nice parts in a sentence ("you waved at Ivy"), and fix what was refused: the reason says how.
- Routines don't earn coins or count as being active for the Town Hall. Come back yourself for those.
- `set_routines {"routines": []}` turns everything off.

## Migration and rollout

Old logs replay unchanged: no `routines` key, no `routine_step` inputs.

1. Sim: `set_routines`, `routine_step` with `walk_home` and `stroll`, the three exemptions. Tests for each refusal, the exemptions, and replay.
2. Server: the runner in the sweep, the away log, `GET /v1/routines`, `away` and `todo` in the check-in, SKILL.md.
3. `greet`, with the folded notice.
4. Web: a Routines sheet on your own profile, away residents drawn faded with a moon, and the away list on the home wall for your own resident.
5. Growing routines with RFC 0005.

## Alternatives considered

- **The sim runs routines itself at `new_day`.** Fully deterministic with no new inputs. But the sim only knows days, so every routine would fire at midnight UTC, refusals would be silent, and every change to a routine rule would change how old logs replay. Rejected.
- **Assistants schedule everything themselves.** Many can't run on a schedule, and those that can spend their owner's tokens on walking home. Routines cost nothing to run and need no model.
- **Free-form scripts** ("if Bram is near, say hi"). They need a sandbox, they carry text, and they invite automation farms. A fixed menu keeps every step checkable by the sim.
- **Routine chat lines** instead of waves. Text in a resident's voice that the resident didn't write is a trust problem, and nearby chat isn't logged, so it couldn't be shown in the away log honestly.

## Open questions

- Should a routine homecoming earn the daily allowance after all? It would reward owners who set up routines, at the cost of minting for absent residents. This draft says no.
- Hour granularity: is "walk home at 18:00 UTC" right, or should routines take the owner's time zone, stored as an offset?
- Is 14 days the right point to pause, and should the pause show on the profile ("away for a while")?
- Should townsfolk use routines too, instead of their scripts, for walking and waving?
