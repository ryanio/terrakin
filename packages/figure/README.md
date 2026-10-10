# @terrakin/figure

Characters for three.js worlds and games, from [Terrakin](https://terrakin.org).

This is an early release. It holds the body spec and the check for a body file. The loader, the clip driver and the rest are planned in [RFC 0031](https://github.com/ryanio/terrakin/blob/main/docs/rfcs/0031-the-figure-package.md). Until 1.0, a minor version can change anything.

## The body spec

A body is one self-contained `.glb` that any loader built on this package can draw.

- Meters, feet on y = 0, centered on the y axis, facing +z with y up.
- A skeleton with a `Hips` and a `Head` bone. The other shared bone names are in `BONES`; a body has the ones its shape has.
- An `idle` clip. `walk`, `wave`, `sit`, `sleep`, `hop`, `flutter` and `fly` are used when present.
- Empty nodes named in `SOCKETS` (`socket_head`, `socket_hand_l` and so on) where things it wears or holds attach.
- Face morph targets named in `extras.targetNames` on the mesh that holds them, from `EXPRESSIONS`.
- No required extension outside `EXTENSIONS`.

## Checking a file

```ts
import { checkBody, glbJson } from "@terrakin/figure";

const report = checkBody(glbJson(bytes), { triangles: 12_000, textures: 4 });
if (!report.ok) console.log(report.problems); // ["no idle clip", "more than 12000 triangles"]
```

`glbJson` reads the JSON out of a `.glb` and throws on anything else. `checkBody` takes that JSON and your limits and returns what the body holds (`clips`, `bones`, `sockets`, `expressions`, counts), what keeps it from being drawn (`problems`) and what a loader falls back from (`notes`).

Both treat the file as outside data. Neither throws on a document of the wrong shape, and the report never carries text from the file except names made of letters, digits and underscores.

The check reads the JSON alone, so it can't tell which way a body faces, how tall it is, or whether its feet are on the ground.

## License

MIT
