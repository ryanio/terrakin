---
title: A townsfolk greets a person in the town square a minute after their first join
date: 2026-10-08
status: accepted
tags: [server, social, onboarding]
---

# A townsfolk greets a person in the town square a minute after their first join

## Context

Four days after launch, 8 of 17 people on terrakin.org never claimed a plot, and the home wall said "0 online now". Joining is now a name and one tap that lands you in the town square by the Town Hall ([decision 0233](0233-a-person-steps-into-the-world-with-only-a-name-over-the-live.md)). Welcome visits ([decision 0142](0142-a-townsfolk-visits-a-person-s-door-minutes-after-their-first.md)) are on, but they only come after a first claim, which half of newcomers never reach. So most people still arrive to an empty square.

`visit` can't take anyone to the square: the sim refuses it for the Commons (`plot_is_commons`).

## Decision

About a minute after a person first joins, a townsfolk resident walks to them in the town square and waves. `TownsfolkWelcome` in `packages/server/src/townsfolk-welcome.ts` does it, on the welcome visit machinery.

- The trigger is a new hook, `WorldService.onNewResident`, which `createResident` calls after the first `join` is logged. Only a brand new record reaches it, so a person coming back, or rejoining after going idle, is never greeted again. It queues a row in `townsfolk_greetings` for a resident of kind `human` who isn't townsfolk, due `GREET.afterMs` (20 seconds) later. The minute sweep carries it out, and the World object's alarm wakes for it no sooner than `WELCOME.wakeGapMs` (a minute) out.
- The greeter is the townsfolk resident whose hearth is nearest the spawn tile. We picked nearness over rotating by UTC day: the same neighbor at the square reads as a town greeter, it's the shortest walk, and when that one can't go the next nearest does. Rotation would spread the walking around, but nobody sees more than one greeting, so evenness buys nothing here.
- The walk uses only commands residents already send. If the greeter's hearth is nearer the newcomer than where it stands, it goes `home` first. Then it takes `move` steps from the sim's `route` until it stands next to the newcomer. Each step goes through `arrive` and `act` and is an ordinary logged input, so nothing new reaches the sim and replay is untouched. The whole walk is planned before anything is sent: a townsfolk whose walk can't get there isn't moved, and the next is tried.
- A newcomer who has already left the Commons gets no greeting (`away`). An invite settles a person on a plot in the same request they join with, and a walk to an empty square would be seen by nobody.
- The wave is `sendGesture` with no note, as the welcome visit's is. There's no model call and no coins; the welcome tip stays with the claim visit.
- A welcome visit later skips the townsfolk who greeted the newcomer when anyone else can go. That brings a second face to the door, and the 10 minute gesture cooldown would refuse the same pair's second wave anyway.
- The guards match the welcome visit's:
  - One row per resident, ever, marked done before anything is tried.
  - At most `GREET.perRun` (3) a run.
  - The row is dropped when it's more than `GREET.staleMs` (5 minutes) old, or when the newcomer has gone offline, is suspended, or has left the Commons.
  - Townsfolk who are suspended, seated at a game table, or blocked either way with the newcomer are skipped, and up to 3 are tried.
  - `TERRAKIN_WELCOME_VISITS` turns greetings on with visits: `off`, `dry` (plans the walk and checks the wave, changes nothing), or `on`.
- Afterwards the greeter stays in the square like any visitor until the idle sweep takes it out.

## Consequences

- A person who steps in sees a townsfolk resident walk up within about a minute, and gets a wave notice.
- Each greeting adds one `home` at most and a handful of `move` inputs to the log (around a dozen for a townsfolk living next to the Commons).
- terrakin.org already sets `TERRAKIN_WELCOME_VISITS` to `on`, so greetings start with the deploy. Self-hosted servers keep it `off` by default.
- Agents aren't greeted, for the reasons decision 0142 gives for visits.
- With townsfolk lessons on (RFC 0024), the greeter now stands within reach of the newcomer when the lessons run in the same sweep, so it may teach them its specialty there. That is the newcomer's townsfolk lesson for the week. We left it: a recipe from the first neighbor you meet is a fair welcome, and lessons keep their own limits.
- Whether this moves claim rates is for the staff Newcomers page (decision 0141) to show, a week after it ships.
- Code: `packages/server/src/townsfolk-welcome.ts`, the hook in `packages/server/src/world-service.ts` and `packages/server/src/api-wiring.ts`. Tests: `packages/server/src/townsfolk-welcome.test.ts`.
