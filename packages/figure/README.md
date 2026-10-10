# @terrakin/figure

Characters for three.js worlds and games, from [Terrakin](https://terrakin.org).

A rigged `.glb` that follows the body spec becomes a `Body`: it plays clips, shows feelings on its face, blinks, breathes, and turns its head to look at things. A scene holds a body and never asks what kind it is.

This is an early release. The plan for the rest (a flat body for characters with no model yet, and a mover for games) is [RFC 0031](https://github.com/ryanio/terrakin/blob/main/docs/rfcs/0031-the-figure-package.md). Until 1.0, a minor version can change anything.

## Two entries

- `@terrakin/figure` has no dependencies. It holds the body spec, the check for a body file, the feeling names, and the pure rules (which clip to play, which face keys to hold). A server can import it.
- `@terrakin/figure/three` draws. It needs `three` (0.160 or later) installed beside it.

## Loading a body

```ts
import { loadBody } from "@terrakin/figure/three";

const body = await loadBody("/bodies/plush.glb", { height: 0.75, id: "r_42" });
scene.add(body.object);

// Once a frame:
body.update(seconds);
```

`loadBody` takes a URL or the file's bytes. `height` is how tall the body stands in your scene, whatever size the file is. `id` sets when this body blinks, so a crowd doesn't blink together.

The file is treated as outside data. It is checked against the spec and your `caps` before anything is drawn, nothing it points at outside itself is fetched, and a file that fails throws a `BodyError` whose `problems` are written by this package, never quoted from the file.

For KTX2 textures, pass your own `KTX2Loader` as `ktx2`, set up with its transcoder and your renderer. Meshopt compression and WebP textures need nothing.

## Using a body

```ts
body.play("walk", { rate: 1.2 });      // loops until another clip is asked for
body.play("wave", { loop: false });    // once, then back to what was playing
body.feel("happy");                    // on the face and in the clip, until another feeling
body.lookAt(new Vector3(1, 0.6, 2));   // the head turns, within about 35 degrees
body.lookAt(undefined);                // and back
body.socket("socket_hand_r")?.add(lantern);
body.still = true;                     // reduced motion: no blink, breath, or bob
body.dispose();
```

- `play` can be called every frame. Asking for the clip that is already playing changes nothing.
- A clip the body lacks falls back. A `walk` bobs the idle, a `hop` squashes and stretches in code, and anything else plays `idle`.
- `feel` holds the face keys the body has for that feeling, and falls back when one is missing (a sad face with no `sad` key half closes its eyes). `laugh` and `surprised` hop once. `sleepy` holds the `sleep` clip.

## Walking

```ts
import { drive } from "@terrakin/figure";

const next = drive({ speed, grounded }, body);
body.play(next.clip, { rate: next.rate });
```

`drive` picks the clip for how the body is moving and the rate that keeps planted feet planted. It needs `body.walkSpeed`, which comes from the file (below). It never plays a walk slower than half speed or faster than 2.5 times; past either end the feet slide, so a game that needs to travel faster wants a faster clip.

## The body spec

A body is one self-contained `.glb`.

- Meters, feet on y = 0, centered on the y axis, facing +z with y up.
- A skeleton with a `Hips` and a `Head` bone. The other shared bone names are in `BONES`; a body has the ones its shape has.
- An `idle` clip. `walk`, `wave`, `sit`, `sleep`, `hop`, `flutter` and `fly` are used when present, and a body may carry more under its own names.
- Empty nodes named in `SOCKETS` (`socket_head`, `socket_hand_l` and so on) where things it wears or holds attach.
- Face morph targets named in `extras.targetNames` on the mesh that holds them, from `EXPRESSIONS`.
- Optionally `walk_speed_m_s` in `asset.extras`: how fast the walk covers ground, in meters a second at the file's size, with the clip played in place.
- No required extension outside `EXTENSIONS`.

## Checking a file

```ts
import { checkBody, glbJson } from "@terrakin/figure";

const report = checkBody(glbJson(bytes), { triangles: 12_000, textures: 4 });
if (!report.ok) console.log(report.problems); // ["no idle clip", "more than 12000 triangles"]
```

`glbJson` reads the JSON out of a `.glb` and throws on anything else. `checkBody` takes that JSON and your limits and returns what the body holds (`clips`, `bones`, `sockets`, `expressions`, counts, `walkSpeed`), what keeps it from being drawn (`problems`) and what a loader falls back from (`notes`).

Neither throws on a document of the wrong shape, and a report never carries text from the file except names made of letters, digits and underscores. The check reads the JSON alone, so it can't tell which way a body faces or whether its feet are on the ground.

## Feelings

`FEELINGS` is the fixed list of what a figure can show: `neutral`, `happy`, `laugh`, `love`, `shy`, `surprised`, `sad`, `sleepy` and `thinking`. `Feeling` is its type and `isFeeling` tells a name on the list from anything else. A feeling is a name, never text, and the list only grows. `FEELING_LOOKS` is what each one asks of a body.

## License

MIT
