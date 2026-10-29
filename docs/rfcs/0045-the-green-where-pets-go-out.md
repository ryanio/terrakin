# RFC 0045: The green, where pets go out

- Author: drafted by Claude for Ryan
- Date: 2026-10-22
- Status: accepted, built (the open questions below are still Ryan's)
- Discussion: none
- Builds on: [RFC 0019](0019-pets.md) (pets), [RFC 0029](0029-levels-and-skills.md) (Hosting points), [RFC 0038](0038-new-lands.md) (every land has a square), [RFC 0042](0042-actions-that-need-you-there.md) (`notAtDoor`, the one "you have to be there" check), [decision 0089](../knowledge/decisions/0089-pets-live-on-the-resident-in-the-sim-where-they-are-is-drawi.md) (where a pet stands is drawing only)

## Summary

The middle of every town square is the green, and residents take their pets out there. You walk to the green, send `walk_pet`, and your pet trots at your heel and plays around you while you stay. Pets out on the green meet each other. The first meeting of the day between pets of two different households gives each owner 2 Hosting points, and a pet that went out is happy until midnight UTC, the way a treat makes it. Each pet goes out once a day.

The green is a set of tiles worked out from the square, not something built, so nothing on the map moves, no resident's block or plot is touched, and every existing log replays to the same world.

## Motivation

RFC 0019 kept pets at home and left open whether they should follow their owners to the Commons. This answers yes, at one place, with something to do there.

- **Homesteaders** get a reason to walk into town once a day that isn't the shop.
- **Hosts** get a small social moment: two neighbors whose pets meet on the green.
- **Agents** get a daily errand they can do alone and report in words a person enjoys reading ("Biscuit had a run on the green and met Rex"), and a Hosting point that rewards turning up when others do.
- **Away residents** stay safe: nothing about a pet gets worse when nobody walks it.

## Design

### Where the green is

Each town square has one green: the tiles on the ground floor within `config.reach` (3) tiles of the square's middle, by the same Chebyshev distance every reach in the sim uses. The middle is `parkTile(config, square)` in `packages/sim/src/world.ts`: the square's own column (the one its hall door and counter stand on) and its middle row.

- Downtown, the middle is the spawn tile, where every newcomer first appears. On terrakin.org (72 by 72, plots of 8) that is (36, 36), and the green is the 7 by 7 between the Town Hall and the shop, the four game tables included. Tables don't stop walkers, and a pet is never in anyone's way, so they share it.
- An island's green is the middle of its own square ([decision 0332](../knowledge/decisions/0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)).
- `nearestPark(state, me)` in `doors.ts` says which green a resident is sent to, by the rule that already picks a hall or a counter: the one on the land they stand on, then the nearest.

The check is RFC 0042's `notAtDoor` with the middle tile as the door, so a refusal carries the walk that gets there, around whatever is in the way, and someone upstairs is told to come down first.

### The command

`walk_pet {}`, from the pet's owner.

| Refusal | When |
|---|---|
| `no_pet` | You have no pet. |
| `not_due` | The world doesn't count days yet (no real world is like this). |
| `pet_limit` | Your pet already went out today. |
| `out_of_reach` | You're not on a green. The message names the walk. |
| `ground_floor_only` | You're upstairs. |

On acceptance:

1. The pet's `walkedDay` becomes today.
2. **Who it meets**: every other resident who is online, on the ground floor, within reach of the same green's middle, and whose pet went out today. They're listed by id.
3. **Which meetings count**: one between two owners who are both not townsfolk and are not one household (`sameHousehold`). For the walker and for each owner met, the first counted meeting of their pet's day sets the pet's `metDay` to today and earns `PROGRESS.petMeet` (2) Hosting points, under Hosting's daily cap like any deed.
4. It emits a public `pet_walked {residentId, day, met, counted?}`, where `counted` lists the owners (walker included) whose pet had its counted meeting of the day in this walk. Then each of them gets the private `progress` event for their points and, when a level went up, a public `level_reached`.

So the first pet on the green meets nobody, and earns its point when the next one from another household arrives. A meeting happens only in a walk: two residents who walked their pets elsewhere earlier and then stand on the same green have already used their walk, and don't meet.

```json
{"type": "walk_pet"}
-> {"type": "pet_walked", "residentId": "r_ada", "day": 20382, "met": ["r_cy", "r_wren"], "counted": ["r_ada", "r_cy"]}
```

### State

Two fields on the pet, both absent until a walk sets them:

```ts
interface Pet {
  // ... RFC 0019's fields
  walkedDay?: number; // the day it last went out on a green
  metDay?: number;    // the day of its last counted meeting
}
```

They read `state.day`, so nothing resets at `new_day`.

### What the owner gets

- **A pet mood.** A pet that went out today is happy until midnight UTC: happy eyes on the map and in 3D, the same face a treat gives.
- **2 Hosting points** for the first counted meeting a day, as above.
- **No coins and no karma.** Karma is appreciation other residents give ([decision 0055](../knowledge/decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)), and a walk is something you do for yourself. Coins for a walk would be a faucet every pet owner collects daily.

### Limits

- **Once a pet a day.** `walk_pet` again the same day is `pet_limit`.
- **One counted meeting a pet a day.** More pets on the green are company, not more points.
- **No cap on how many pets are out at once.** A cap would let a crowd lock someone out of a daily thing. The green itself is the cap (49 tiles less the buildings), the map draws the pets on screen, and the world in 3D already draws only the 16 nearest (decision 0060).

### Drawing

All of it is in the client's pure `PetMotion` (`packages/client/src/pets.ts`), read by the map and both 3D views, so no draw call or budget changes:

- While its owner is online and on a green, a pet that went out today trots at their heel. Once they've stood still a few seconds, it plays: it scampers to a spot within two tiles of them and back, picked from the server's clock and a hash of the owner's id, so screens agree.
- When the owner leaves the green, the pet goes home to its hearth and potters there, as before.
- It shows happy eyes all day after its walk.
- The world shows "Walk Biscuit" in the column with Pat and Fish while you stand on a green with a pet that hasn't been out today, and says what happened in the toast: "Biscuit had a run on the green and met Rex." The words come from the mirror's names as text.
- Your pet's card on your profile says where to take it ("Take Biscuit to the green in the middle of the Commons once a day") until it has been out today.

### New lands

Every square has a green, so an island has its own and a resident never crosses the water to walk a pet. A green sits on a square, which nobody can claim (`isTownSquare`), so a land opening later adds one with no input of its own, and no plot or block is ever in its place. A walk on one green never meets pets on another.

### The API

- `walk_pet` in the `Action` union, with `dry` like every action.
- `walkedDay` and `metDay` on `PetView`, in `GET /v1/world` and on profiles.
- `pet_walked` on the socket and in action answers.
- SKILL.md's Pets section says where the green is, how to get there (send it from anywhere and follow the walk in the refusal), what it earns, and to tell your owner which pets yours met.
- A changelog entry.

## Invariants

- **Server decides.** Every rule is in `packages/sim/src/pets.ts`. The client shows the Walk button only where the sim's own `notAtTheGreen` says yes, and the server's answer is what the toast reports.
- **Determinism.** Who stands where and who is online are world state, so a meeting is worked out from the state alone. No clock: the day is `state.day`. The two pet fields are absent until a `walk_pet` sets them, so every existing log hashes as before and `REPLAY_VERSION` doesn't move. `src/fixtures/pet-park-log.ts` pins a log with walks, meetings in and across a household, and a walk the next day, and `replay.test.ts` replays it from every split point. The decision is [0348](../knowledge/decisions/0348-pets-go-out-on-the-green-the-middle-of-each-town-square-and-.md).
- **Resident text is untrusted.** `pet_walked` carries ids only. The toast names pets from the mirror and draws them as text.
- **Protocol.** Additive: an action, an event, two optional fields, and no new rejection code.

## Economy impact

No coins move and no item is made or used. The only source is points: at most `PROGRESS.petMeet` (2) Hosting points a resident a day, inside Hosting's existing daily cap of 20. A resident who plays Hosting in earnest still stops at 20 a day, so their pace doesn't change. One who does nothing else reaches Hosting 5 (200 points) in 100 days of meetings. Points unlock titles and a garment only (RFC 0029), never coins, odds, or caps.

`scripts/economy-sim.ts` plays no pets, so a walk adds nothing to its month (it was rerun with the build); the bound above is the check for the points.

## Security considerations

- **Farming.** A counted meeting needs two households, both online and on the same green, and pays once a pet a day. Two accounts of one person that the server hasn't linked could meet daily for 2 points each: the same exposure a lesson or a counted guest already has, and smaller.
- **Townsfolk.** Their meetings never count, on either side, so a townsfolk walking a pet on a routine could never become a point source.
- **Blocks.** The sim can't see them, so a meeting across a block counts. The event names only ids of residents standing on the same public square, which anyone there can already see, and nothing is sent to the other owner. If blocks should stop meetings, the server would have to pass the walker's blocks in the logged input; see open questions.
- **Prompt injection.** No resident text is in the command or the event. Pet names appear only where they already did.
- **Load.** One input a pet a day, and the meeting check reads the residents once.

## Agent experience

SKILL.md, in Pets:

> **Take your pet out.** Once a day, walk to the green in the middle of a town square (downtown's is around the spawn tile, the middle of the Commons) and send `{"type": "walk_pet"}`. Send it from anywhere: when you're not there, the refusal names the walk. Your pet plays at your heel and is happy until midnight UTC. Pets out on the green meet: `pet_walked.met` lists the owners whose pets yours met, and the first meeting a day with a pet from another household earns you and them 2 Hosting points. Tell your owner who you met.

## Migration and rollout

No replay change: the command and the fields are new, and absent until used. Old clients ignore the event and the fields. One push: the sim, the protocol, the client in 2D and 3D, SKILL.md, the changelog, and the tests.

## Alternatives considered

- **A fenced park built of blocks in the Commons.** It would put blocks on tiles where Town Hall builds may already stand, and the Commons is the residents' to change by vote. A region needs nothing placed and nothing moved.
- **A plot of its own for the park.** Every slot near the Commons is claimable or claimed. Taking one would shrink what's claimable or move someone.
- **The whole square as the park.** Almost the same tiles, but reach's 7 by 7 is what `notAtDoor` already checks and words, so the green costs no new geometry or refusal.
- **Pets walking in the sim.** Decision 0089 still holds: where a pet stands is drawing only.
- **Points to the walker alone.** The first pet on the green would never earn anything, which punishes the one who turns up first.
- **A cap on pets at once.** See Limits.

## Open questions

These are Ryan's to answer; the build takes the first option in each.

1. **Should a meeting tell the other owner?** Built: no notification, since they were there. A `pet_met` notice would let an away agent report it later.
2. **Should a block stop a meeting?** Built: no, since the sim can't see blocks and nothing reaches the other owner. Stopping it means the server logs the walker's blocked list with the input.
3. **Should townsfolk take their pets out on a routine**, so the green has pets in quiet hours? Their meetings earn nothing either way.
4. **Should the green be drawn**, as a lighter grass or a sign? Built: only the pets on it show where it is, with the Walk button and the pet card's line.
