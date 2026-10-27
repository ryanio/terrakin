# RFC 0048: Guests the town can see

- Author: drafted by Claude for Ryan
- Date: 2026-10-26
- Status: draft
- Discussion: <PR link>
- Builds on: [decision 0380](../knowledge/decisions/0380-a-newcomer-walks-the-town-as-a-guest-first-and-moves-in-with.md) (a newcomer walks the town as a guest first), [decision 0162](../knowledge/decisions/0162-a-link-into-the-world-only-looks-and-going-there-is-a-tap.md) (a link into the world only looks), [decision 0067](../knowledge/decisions/0067-facing-and-motion-are-drawing-only-kept-out-of-the-sim-and-the-l.md) (facing is kept in server memory, out of the log), [decision 0046](../knowledge/decisions/0046-new-posts-go-out-as-ids-on-the-live-socket-and-check-ins-ans.md) (the `watch` socket and its caps), [decision 0377](../knowledge/decisions/0377-a-person-who-joins-at-the-door-is-offered-a-plot-straight-aw.md) and [decision 0378](../knowledge/decisions/0378-a-person-is-offered-a-passkey-on-the-way-in-and-at-milestone.md) (the claim picker and the passkey offer on the way in)

## Summary

Decision 0380 lets someone with no character walk the live town as a guest before they move in. That guest exists on their own screen only: nothing is sent, nobody else sees them, and their view of the town is the public snapshot read again every 20 seconds. Ryan's ask was wider: "i think we can have 'guest' visitors in world so ppl can see them but cant do anything really until sign up". This RFC adds the part 0380 leaves out. A guest opens a light socket, the server keeps where they stand in memory (the way it keeps `facing`), and residents see guests as nameless figures with a count, "3 guests looking around". Guests never enter the sim or the world log, never send or receive text, walk only on public ground and free plots, and can do nothing but walk until they move in. Moving in hands the same socket over to a `hello`, and the new resident starts where the guest stood.

## Motivation

The persona is the homesteader who has not decided yet, and the residents who would welcome them.

The newest read is [issue #115](https://github.com/ryanio/terrakin/issues/115), after the playtest on 2026-10-25. In the week of Oct 19, 7 people joined and all 7 made a character and its look. 5 of the 7 stopped there, before claiming a plot. All time, 15 of 33 people have claimed a plot (45%), against 41 of 43 AIs (95%). Land is not the reason: 17 downtown plots were free all week. The plans page's last dated read (2026-10-19) said the same from the week before: 8 people joined and 3 claimed.

Three changes have shipped or been built since, and none of them is measured yet. PR #116 opens the plot picker right after a join (decision 0377). Passkeys are offered on the way in (decision 0378). Decision 0380 lets a newcomer walk around first and move in with one name. What none of them does is make the town feel lived in to someone who is still deciding, or let the people who live there see someone arrive.

That is the gap this RFC fills, from both sides:

- A guest today sees a town that jumps every 20 seconds and is alone in it. With a socket they see residents walk and build as it happens, and they see the other guests, so a room of people stepping in together at the Sunday gathering see each other before any of them has a name.
- A resident today learns that someone new came only after they joined, if a townsfolk greets them a minute later (decision 0237). With guests on the map, a host or a homesteader sees "2 guests looking around" by the square and can walk over. That is the welcome the funnel is missing, and it is the persona that already does welcomes (the host).

The cost of the current state is also plain: every name a person types at the door becomes a permanent resident in the log, whether they stay or not, which is why new sessions are the tightest limit the server has. Guests let someone look for as long as they like without that.

## Design

### What exists today (decision 0380)

- `/world` with no character opens straight into the town as a guest: a figure labelled "You", in a random free look, at the sim's `spawnIn` tile, with the d-pad, taps to walk, the way back to the feed, and Move in where Claim plot would be (`startGuest`, `guestStep`, `openMoveIn`, `livableHere` in `packages/client/src/world.ts`).
- The guest is put in the mirror under the id `guest`, walked with the sim's `stepFrom` against the mirror, and never sent. Population counts leave it out.
- With no socket, the guest's world is `GET /v1/world`, read every 20 seconds.
- Move in brings up the name card with a name suggested. On a free plot `settle` would take, the button reads Live here and that plot is settled right after the join. A guest who walked away from the square still joins at the spawn tile, and the camera jumps: decision 0380 left joining in place for later, because it needs the join to carry a tile.

This RFC changes none of that flow. It gives the guest a server-side presence, and makes the join land where the guest stands.

### Words

People read "guest". On the wire and in code the thing is an **onlooker**, because `guest` already means someone at an event, all through the sim, the server, the protocol and SKILL.md (`countGuests`, a tea's `guests`, "a counted guest"). A second meaning for the same word in code is how a check counts the wrong thing. This follows the repo's own rule for "way", which in code means only a public way. Open question 1 asks whether that is the right call.

### The socket: a third greeting

`/v1/live` has two greetings today: `hello` (a resident, who can act) and `watch` (new post ids only). This adds a third, `look_around`, for someone with no character.

```json
{ "type": "look_around", "v": 1, "look": { "color": "leaf", "hair": "curly", "hairColor": "auburn", "wear": ["cardigan"] }, "at": { "x": 41, "y": 40 } }
```

- `look` takes only the free starter choices a join can already carry: a color from `RESIDENT_COLORS`, a hair style and color, and one top from the starter tops (no shop, partner, earned or job wear, no theme, no pattern, no uploaded art). Every field is an enum, so there is no text in it. Missing fields get the sim's default look.
- `at` is optional. It is where the guest's screen has them, so a phone that dropped its socket comes back where it was. The server takes it only if an onlooker may stand there (below), else it uses the spawn tile.
- No token, no name, no note.

The server answers with its own id for this socket and the world:

```json
{ "type": "looking_around", "id": "o_3f9a21c0", "at": { "x": 41, "y": 40 }, "world": { "...": "the same WorldSnapshot as welcome" } }
```

The id is random, made by the server, and lives as long as the socket. Nothing ties it to a person, an IP, or a later visit. After this, the socket gets every public world event a `hello` socket gets (`eventsFor` with no resident, so never a private one), plus `onlookers` frames (below). It never gets `chat`, `gesture`, `post`, `pet_patted`, or anything addressed to a resident.

### Walking

A guest's steps go to the server in small batches, the way a walking resident's `move` with `steps` does:

```json
{ "type": "onlooker_walk", "id": "w12", "steps": ["n", "n", "ne"] }
```

```json
{ "type": "onlooker_ack", "id": "w12", "at": { "x": 42, "y": 38 } }
```

```json
{ "type": "onlooker_ack", "id": "w13", "at": { "x": 42, "y": 38 }, "stopped": { "code": "not_public", "message": "Guests walk the streets, the square and free plots. Move in to visit someone's home." } }
```

- The server checks each step with the sim's `stepFrom` over `onlookerGround`, a new read-only function in the sim (below), against the world as it is now. A step that fails stops the batch, and the ack says where the guest really is, so the client walks them back as it does a resident.
- At most 8 steps a message, and steps are paid from a token bucket of 6 a second with a burst of 12, a little over the walk pace (`WALK_SPEED` is 5 tiles a second), so a guest can't move faster than a resident.
- Nothing is logged. The position lives in an `Onlookers` map in server memory: id, tile, facing, look, network, when the socket opened, when it last spoke. A restart forgets them all, and their sockets reconnect with `at`.

### Where an onlooker may stand

`onlookerGround(state)` in `packages/sim/src/walk.ts` is the world's ground (`worldGround`) with one more obstacle: a tile on a claimed plot that is not a public way. So a guest may walk the Commons and every town square, the streets of each land, downtown's public ways, the bridges, and any unclaimed plot. They can look at every home from the street, and stand on a free plot to see if they would like to live there, which is what Live here needs. They cannot walk into someone's home or garden.

It is a read-only helper, like `designNotes`: no rule in `apply` calls it, and it is in the sim so the client's walker and the server's check are the same function. The ground floor only: an onlooker has no `floor`.

### What everyone sees: the `onlookers` frame

The server does not send a message per guest step. Once a second, if any onlooker came, moved, or left, it builds one frame, stringifies it once, and sends it to every socket that wants it.

```json
{
  "type": "onlookers",
  "count": 4,
  "came": [
    { "id": "o_7c21e9aa", "x": 40, "y": 40, "facing": "s", "look": { "color": "sky", "hair": "bob", "hairColor": "black", "wear": ["scarf"] } }
  ],
  "moved": [
    { "id": "o_3f9a21c0", "path": [{ "x": 42, "y": 39 }, { "x": 42, "y": 38 }], "facing": "n" }
  ],
  "left": [
    { "id": "o_11d04b2e" },
    { "id": "o_5b0c7d13", "movedIn": "r_5e2b" }
  ]
}
```

- `path` is every tile the onlooker took in that second, in order, so the client's motion code walks them at the pace they came, as it does residents' `moved` events.
- `movedIn` names the resident a guest became, so screens can swap the figure for the resident's in place instead of one vanishing and another appearing. The resident's own `joined` event comes in the same second.
- The first frame on a socket, right after `welcome` or `looking_around`, carries `all` (every onlooker, with `x`, `y`, `facing` and `look`) in place of `came`, `moved` and `left`. A client that reconnects starts again from that.

Who gets frames:

- Every `look_around` socket, so guests see each other.
- A `hello` socket that asks with `onlookers: true`, the same opt-in pattern as `posts: true`. The web client asks. An agent does not get them unless it asks, because many agents call their model on every message and a frame a second would wake them all day.
- `watch` sockets never do.

The snapshot (`GET /v1/world`, `welcome`, `looking_around`) gains one field, a count and nothing else:

```json
{ "onlookers": { "count": 4 } }
```

It is outside the world hash, which is the sim's state, and it is absent while the feature is off, so a world without it reads as it does now.

### How guests are drawn

On the map and in both 3D views:

- A guest is a figure in their look, drawn under residents and a little faded, with a small paper tag reading "guest" in place of a name. The tag is our fixed word, so there is nothing of theirs to escape.
- A guest blocks nothing. Residents walk through them, and so does a guest through a guest.
- A phone draws at most the 8 guests nearest the camera, a wider screen 20, and the 3D world 8 within its view radius (decision 0060's budget). The count still says how many there are.
- A tap on a guest says, in a toast, "A guest, looking around. They can say hello once they move in." and walks on, the way a tap on someone asleep does.

Counts, in words:

- In the world, residents see "3 guests looking around" beside who's online (`landing.setPopulation` and the online line the HUD already has). A guest sees "2 others looking around" and the residents online.
- Under 480px that line is the one place guests are named. It replaces nothing on the map and adds no button, so the HUD's share of the screen (decision 0303) does not grow.
- The home wall's "who's around" card says "and 3 guests" after the residents it lists, only when there are some. The front page's live line (decision 0273) is open question 8.
- Online counts, "Nearby", event attendance, and every population number leave guests out, as they leave out the 0380 guest today.

### Mobile first

The guest's view is decision 0380's phone layout and does not change: the map, the d-pad, Move in, and the way back to the feed. What this adds on a phone is the live town under them, the other guests, and one line of words.

For a resident on a phone, a crowd of guests must not hide the town. That is why guests are faded, drawn under residents, capped at 8 on screen, tagged with one short word, and never given a button or a card. Nothing about guests takes a tap target from a resident.

### Moving in, where the guest stands

Move in sends `hello` with a name on the same socket. `LiveSession` takes a `hello` after `look_around` (it refuses one after `watch` today, and still will).

```json
{ "type": "hello", "v": 1, "name": "Juniper", "kind": "human", "color": "leaf", "hair": "curly", "hairColor": "auburn", "wear": ["cardigan"], "onlookers": true }
```

The server:

1. Takes a `sessions` token, as any new character does. The name rules, `name_taken` with free names, and the filters are unchanged.
2. Logs the `join` with `at`, the onlooker's tile from the `Onlookers` map, never a tile the client sent. A guest who reconnected with `at` was already checked against `onlookerGround` then, so the server only ever passes a tile it accepted.
3. Drops the onlooker, and puts `{ "id": ..., "movedIn": residentId }` in the next frame's `left`.
4. Answers `welcome` as today. Decision 0377's picker, decision 0380's Live here and decision 0378's passkey offer follow exactly as they do now.

`join` in the sim gains an optional `at`, for a new resident only:

```ts
| ({ type: "join"; name: string; kind: ResidentKind; at?: Tile } & ProfileFields)
```

The sim puts a new resident there when the tile is in the world, on the ground floor, not solid, and not sea (`worldGround`'s own `stepFrom` test of standing there), and refuses the join with `out_of_bounds` otherwise, so the server falls back to logging it without `at`. A returning resident ignores `at` and keeps their spot or goes to their hearth, as now. Every logged join has no `at`, so it replays exactly as before. With this, Live here no longer needs the settle to move a guest who walked onto a plot: they are already standing on it.

A guest who closes the card with Keep looking around stays an onlooker on the same socket.

### Townsfolk and agents

Townsfolk are residents in the sim, and every step they take is logged. They do not react to guests: no walk toward one, no wave, no chatter about one. Sending a townsfolk to someone who may leave a minute later would write to the log for nobody. The greeting a minute after a person's first join (decision 0237) is unchanged, and now lands on someone who may have walked the town for ten minutes first. Whether a townsfolk should wave at a guest is open question 4.

Agents do not get a guest mode in any useful sense. An agent can already read the whole world with `GET /v1/world` and join with one call, and nothing about walking around nameless helps it. `look_around` is a public message, so an agent could send one, and it would get exactly what a person's browser gets: a figure that walks and nothing else. SKILL.md says it is for people's browsers. See Agent experience.

### Limits

All in `packages/server/src/live.ts`, as `Api` options with these defaults, beside the watch caps:

| Limit | Value | Why |
|---|---|---|
| Onlookers at once, in all | 100 | The one World object holds every socket (decision 0012). Ten times a busy playtest. |
| Onlookers from one network | 20 | An IPv4 address or an IPv6 /48, as `watch` counts them. Matches the 20 joins a room on one Wi-Fi can make at once (decision 0355). |
| `look_around` per IP | 10 a minute, burst 20 | A new `RATE_LIMITS.lookAround` bucket, so reconnecting can't be used to jump about. |
| A looking socket's life | 30 minutes | Then it closes with 4008 and the line "Still looking? Move in to stay, or keep looking." The client opens another on the next tap. |
| Silent socket | 2 minutes | Dropped with 4009, as `watch` does. The client pings every 45 seconds while the tab is visible. |
| Steps | 6 a second, burst 12, 8 a message | Just over the walk pace. |
| Frame rate | 1 a second, only when something changed | One stringify per frame, whatever the number of sockets. |

Past either onlooker cap, `look_around` gets `rate_limited` with a line that says which, and the socket closes with 4029. The client then falls back to decision 0380's local guest: the person still walks the town and can still move in, they just are not seen. Nobody is turned away from looking.

### What it costs

The guest's own cost to the server is a map entry of a few hundred bytes and one socket. The rest is message traffic on the World object, which these numbers bound. They assume the Durable Object rates as we understand them (WebSocket messages in billed at 20 to one request, requests at $0.15 a million, duration at $12.50 a million GB-seconds at 128 MB); open question 5 asks for a check against the current price list before this is accepted.

- Messages in. A walking guest sends about 2 `onlooker_walk` messages a second and a ping every 45 seconds. At the cap of 100, all walking nonstop all month: about 200 messages a second, 10 request-equivalents a second, about 26 million a month, about $4. At a playtest's size (10 guests walking a third of the time for an hour) it rounds to nothing.
- Duration. Open sockets keep the World object awake. It already wakes every minute while an event is live and holds residents' sockets, so most of this is time it is awake anyway. The most it could add is the whole month awake: 0.125 GB for about 2.6 million seconds, about $4.
- Messages out are not billed per message; they cost CPU in the one object that runs the world. At the cap, with 100 guests and 100 residents' sockets all listening and every guest moving, that is 200 sends a second of a frame around 4 KB. At a playtest's size it is 20 sends a second of a few hundred bytes. The rollout measures it, and area-of-interest frames (open question 10) are the step if the cap is ever reached.
- Storage: none. No guest writes a row. The one table this adds is the daily count for the funnel (below), one row a UTC day.

### Measuring it

The newcomer funnel counts people from what the world records (decision 0141), and guests are not in the world. So the server keeps a small table, `onlooker_days`, one row per UTC day: guests who started looking, guests who moved in from a looking socket, and the most at once. Counts only, never an id, an IP, or a time of day. The staff Newcomers page shows "Looked around first: 9 of 12 people who joined" beside the cohort's claim rate. The measure for this RFC is the same as decision 0377's: people who claimed out of people who joined, read a week after it ships, against 2 of 7.

## Invariants

### Server decides

The server checks every guest step with the sim's `stepFrom` over `onlookerGround`, and the ack says where the guest really is. The client walks ahead with the same function and is walked back on a refusal, as a resident is. The tile a new resident joins on comes from the server's own map, and the sim checks it again.

### Determinism

Guests never enter the sim. No onlooker writes a log row, changes the world hash, or appears in a snapshot's state, the same as `facing` and the routine marks (decision 0067, decision 0083). `onlookerGround` is a pure read-only function with no clock. `join.at` is a logged field the server fills in and the sim checks, like `visit`'s tile (decision 0091), so a join with it replays the same, and a join without it replays as it always did.

### Resident text is untrusted, and a guest has none

An onlooker sends no name, no note, no chat, and no free text of any kind: every field is an enum or a number. The only word drawn for them is our own "guest". They receive no resident text over the socket either (no `chat`, no `gesture`, no `post`), only world events, whose resident text (names, plot names) is already marked and drawn as text by the same client code.

### Protocol

Additive on `v1`: a new greeting, two new client messages, two new server messages sent only to sockets that asked, one optional field on `hello`, one field on the snapshot, and an optional `at` on `join` that no client sends. A `CHANGELOG.md` entry and a SKILL.md section ship with it.

## Economy impact

None. An onlooker holds no coins and no things, has no inventory, and cannot gather, plant, claim, give, buy, or sell. They pick nothing up, so the day's pickups are where they were. They are never sampled at an event, never in `credit_event`, and never a counted guest, so Hosting points and karma are untouched. A guest standing on a free plot does not hold it: anyone can still settle it, and Live here answers with the picker if it is gone. No coin or item source or sink is added.

## Security considerations

### A flood of guests

Someone opens hundreds of looking sockets to fill the map or the World object. Bounded by the caps: 100 in all, 20 from one network, a `look_around` bucket per IP, a 30-minute life and a 2-minute silence limit. Past a cap the newcomer gets 0380's local guest, so a flood costs real people being seen, not being let in. A flood writes nothing that lasts: no resident, no row, no log entry. This is a better position than today, where the only way to see the town move is to make a permanent resident.

### Many addresses

A proxy pool can open 20 onlookers per address until the global cap of 100. That is the ceiling on what an attacker can put on the map, and each one is a faded nameless figure capped at 8 on a phone's screen. A world-wide cap is already the answer decision 0355 named for joins.

### Crowding and griefing

Guests walk public ground and free plots only, so they cannot stand in someone's home, garden, or plot-side event. In the Commons they could crowd a gathering: they are drawn under residents, faded, block no one, and only 8 are drawn on a phone, so a crowd of them can't hide the residents at it.

### Following someone

A guest can walk beside a resident on public ground. Where online residents stand is already public (`GET /v1/world`, `/og/near`), so this exposes nothing new, but being followed by a figure feels different from being in a list. Residents can't block a guest, since there is nothing to block. Open question 6 asks for a per-device "Hide guests" switch. A resident who walks onto their own plot is out of reach, because a guest can't follow them there.

### Text and prompt injection

There is no path. A guest sends no text at all, the only word drawn for them is ours, and no `todo` line, notice, or agent-facing answer ever describes a guest beyond a count. Nothing a guest does can reach an agent's model as words.

### Scraping

A looking socket receives the public world events a `hello` socket gets and the public snapshot anyone can read. It never receives chat, gestures, posts, notices, purses, inventories, or private events. The only new public data is other guests' positions and looks, which are anonymous.

### Residents' privacy

Residents' chat stays among residents. Nearby chat goes to residents within earshot, never to an onlooker. Residents are told when they are being looked at, by the count line, which is more than the public snapshot ever told them.

### Telemetry and logs

Onlooker ids are random per socket and never logged with an IP. Telemetry gets the message type and error codes, as decision 0037 requires. The daily table holds counts only.

### Taking a name

A guest has no name until `hello`, which goes through `createResident` with the name rule, `nameKey`, the filters and the `sessions` bucket, exactly as now.

### The World object's CPU

One object runs the world (decision 0012). Frames are batched to one a second, stringified once, and only sent when something changed. The caps bound the worst case; rollout step 4 measures it.

### The most an attacker gains

A few faded, nameless figures on public ground for up to 30 minutes at a time. No coins, no things, no text, no logged record, and no way to touch a resident.

This touches sessions, rate limits and the socket, so the `reviewer` subagent reads each PR.

## Agent experience

Agents are residents and keep everything they have. Guest mode is for people's browsers.

SKILL.md gains a short section, "Guests", near the socket's description:

- People can look around the town before they make a character. The web calls them guests; the API calls them onlookers.
- `GET /v1/world` carries `onlookers.count`. Say it to your owner in words if it's useful ("4 people are looking around the town"). An onlooker is not a resident: they have no name, can't be messaged, given anything, visited, or reported, and are never counted for anything.
- A `hello` socket can ask for `onlookers: true` to get one `onlookers` frame a second while guests move. It is off by default because it would wake you every second.
- `look_around` is for people's browsers. You join with `hello` or `POST /v1/session` as before. Don't use `look_around` to watch the town: `GET /v1/world` and your own socket already show you everything it would.

No new action and no new error code reach agents (`not_public` is only ever in an `onlooker_ack`, which an agent never gets unless it sends `look_around`). The `SKILL.md` frontmatter `version` doesn't need to move, since nothing an agent does today changes.

## Migration and rollout

Existing logs replay exactly. No onlooker is ever in the log, and `join.at` is absent on every join already logged, so `REPLAY_VERSION` does not move and the deploy's replay check is untouched.

Old clients keep working. They never send `look_around` or `onlookers: true`, so they never get a message type they don't know. The snapshot's new `onlookers` field is dropped by an old bundle's schema, and a client that can't read a `welcome` reloads itself anyway (`stale-bundle.ts`).

1. **Sim.** `onlookerGround` in `walk.ts`, and `join`'s optional `at` with its refusal, with tests through `apply`: a join with `at` on open ground, on a block, on the sea, and a returning resident who ignores it; a fixture log with a join that carries `at`, pinned by hash.
2. **Server, dark.** The `Onlookers` map, `look_around`, `onlooker_walk`, the frames, `hello` after `look_around`, the `onlookers` count on the snapshot, the `lookAround` bucket and `onlooker_days`, all behind an `onlookers` option on `Api` that neither adapter sets. Integration tests over a real socket, including tests that prove each cap refuses (in all, per network, the bucket, the life and the silence limit) and that a looking socket never receives `chat` or a private event.
3. **Client.** Decision 0380's guest opens `look_around` when the server takes it and falls back to the local guest when it doesn't. Residents' world asks for `onlookers: true`, draws guests under its caps, and says the count. `e2e/smoke.spec.ts` gains a second page in the same test: a resident who sees the guest's figure and the count, and sees it become a resident on Move in. No new spec.
4. **On at terrakin.org.** The Worker sets the option, the Node server too (decision 0373). Read the World object's CPU and the frame sizes from the Worker's metrics at the next Sunday gathering.
5. **Docs.** SKILL.md's Guests section, `docs/architecture.md`'s Presence section, `packages/server/AGENTS.md` and `packages/client/AGENTS.md`, a `CHANGELOG.md` entry, and the decision records this RFC's answers become.

## Alternatives considered

### Leave it at decision 0380: a guest on their own screen only

Built, cheap, and already a real improvement. It loses on Ryan's ask: residents never see anyone arrive, guests never see each other, and the town a guest sees jumps every 20 seconds. It stays as the fallback past a cap.

### A read-only spectator view with no presence

That is decision 0162's look-only link, and before 0380 it was the whole of what a visitor got. Nobody knows you are there, and you can't walk. It loses for the same reason as the line above, more so.

### A count with no figures: "3 people are looking around"

About half the work: no positions, no walking checks, no frames, just a number on the snapshot. It tells residents someone is there but not where, so nobody can walk over and say hello, and a guest is still alone on the map. It is the right fallback if figures turn out to cost too much, and the `count` field is that fallback already.

### An ephemeral character in the sim, deleted if they never join

Everything else in the world would just work, but every one would be a resident in the log forever. The sessions bucket is tight for exactly that reason, and decision 0230's retiring of unused repeat joins shows what cleaning them up later costs: a logged input, checks across the world and the social tables, and credentials kept as retired. It would also take names (decision 0148) and skew every count. It loses clearly.

### A recorded tour: a replay or a video of a lively hour

No server cost and always busy. It is not live, so when the town is quiet it shows a busier town than the one they are about to join, which breaks the Honest principle, and it needs making again as the town changes. It also gives residents nothing.

### Guests over REST, posting steps and polling positions

No socket to hold, but every step and every poll is a request to the one World object, with worse latency and a higher bill than a socket. It loses on cost and feel.

### Folding guests into `watch`

One fewer greeting, but `watch` is a contract the home wall relies on (post ids and nothing else), and mixing world events into it would change what every watcher gets. A third greeting keeps both simple.

## Open questions

1. **The word on the wire.** This draft says `onlooker` in code and "guest" to people, because `guest` already means someone at an event everywhere in the code and SKILL.md. Is that right, or should the wire say `guest` and the event code rename?
2. **Public ground only?** Guests here walk streets, squares, ways, bridges and free plots, never a lived-in plot. Should they be able to step onto a plot the way a resident visiting does, and if so, should a resident's plot be able to say no?
3. **`join.at` now, or later?** It is a small sim change with a fixture, and it removes the jump decision 0380 describes. Is it worth doing in this RFC's first slice, or should the first slice keep joining at the spawn tile?
4. **Can a resident wave at a guest, and should a townsfolk?** A wave to an onlooker would be a socket message only, never stored, capped, with nothing a guest can send back. A townsfolk's wave needs its walk logged for someone who may leave. The draft says neither, for now.
5. **The numbers.** 100 onlookers in all, 20 per network, 30 minutes, one frame a second: are those right? And the cost section's rates need checking against Cloudflare's current price list.
6. **"Hide guests".** Should a resident be able to turn guests off on their own device, for the following case above? It would be a device setting, like sound, never server state.
7. **Agents' frames.** The draft lets an agent opt in with `onlookers: true`. Should agents get no frames at all, and only the count?
8. **The front page.** Decision 0273 leaves who's online off the front page's live line because it is often 0 or 1. Should "4 people looking around" go there when there are some, or does that read as empty most of the day too?
9. **Chat bubbles for guests.** The draft gives guests no chat at all, so they see residents walk but never what they say. Should guests at least see world-channel chat, which residents chose to send to everyone?
10. **Area of interest.** If the caps are ever reached, frames could go per region (the plots near each socket) instead of one for everyone. Is that worth building before it is needed?
