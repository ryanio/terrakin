# RFC 0031: The figure package: one character engine, published

- Author: drafted by Claude for Ryan
- Date: 2026-10-10
- Status: draft
- Discussion: <PR link>
- Builds on: [RFC 0012](0012-character-bodies.md) (a partner character drawn as its own rigged body), [RFC 0013](0013-expressive-characters.md) (feelings), [decision 0253](../knowledge/decisions/0253-one-package-terrakin-figure-is-published-to-npm.md) (the package is public on npm).

## Summary

Put everything that draws and moves a character body into one package, `@terrakin/figure`, with three.js as its only dependency, and publish it. Terrakin's world uses it for RFC 0012. Other projects use it for their own pages and games, MUSEGOD's site first (`plans/figure-engine.md` in ryanio/musegod). A body is one of two kinds behind one interface: a rigged `.glb` that follows the body spec, or a flat picture standing up, so a character with no 3D model yet still has a body.

So far it holds the spec, the check for a body file, the feeling names, and the rigged body. The rest lands in the steps below.

## Motivation

- **Agents and their owners:** RFC 0012 promises a linked character standing at its hearth as itself. Nothing loads a rigged body here yet, so that loader has to be written either way.
- **Partners:** a collection that wants its characters in Terrakin needs to know what file to make and whether a file passes. A published spec and check answer both before anyone asks us.
- **Other builders:** the same characters appear on a partner's own site and in its games. With one package, a fix to how a body blinks or plants its feet reaches every place it is drawn.
- **Us:** writing it as a package with no way to reach the sim keeps presentation out of the rules by construction.

## Design

### The package

`packages/figure`, MIT, public on npm. It imports nothing from the sim, the protocol, or the shared UI. Its tests build a plain plush in code and never use a partner's files, which aren't MIT.

It has two entries. `@terrakin/figure` has no dependencies and holds the spec, the check, the feeling names, and the pure rules, so the server and the feed can import it. `@terrakin/figure/three` draws, with three.js as a peer.

### The body spec (released)

`src/spec.ts`. One self-contained `.glb`, in meters, feet on y = 0, centered, facing +z. A skeleton with `Hips` and `Head`, an `idle` clip, the eight sockets of RFC 0012, face morph targets by name, and no required extension outside a short list. `checkBody` reads a file's JSON and returns what it holds, what keeps it from being drawn, and what a loader falls back from. Limits (triangles, materials, textures, joints) are the caller's, since the world's budget for 24 bodies and a single viewer's are different numbers.

### The body interface

```ts
interface Body {
  readonly object: Object3D;
  readonly height: number;
  readonly clips: readonly string[];
  readonly walkSpeed: number | undefined;
  still: boolean;
  socket(name: SocketName): Object3D | undefined;
  play(clip: string, options?: { loop?: boolean; fade?: number; rate?: number }): void;
  feel(feeling: Feeling): void;
  lookAt(point: Vector3 | undefined): void;
  update(seconds: number): void;
  dispose(): void;
}
```

A scene holds a body and never asks which kind it is.

- **Rigged (released):** `loadBody` checks a `.glb` against the spec, then loads it with the loader `model-viewer.ts` already uses, refusing anything outside the file. A missing clip falls back (`walk` to `idle` with a bob, `hop` to a squash made in code). `still` holds it for reduced motion.
- **Paper:** a transparent picture on a thin card with a white edge and a small base. It turns to face the camera within about 35 degrees, breathes from its foot line, waddles to walk, and shows a feeling as the floating icons the peg already draws, since a painted face can't change. It has two sockets, head and halo.
- **The peg** stays in `packages/client`. It is drawn from looks, the palette, and wear, which this package can't import. It implements the same interface where it is.

### Feelings and life at rest

The feeling names live in the package and `@terrakin/ui/feelings` re-exports them, so there is one list. The package maps each to face keys and a clip by the table in RFC 0013, and adds blinks at a phase from the body's id, a breath in the head, and a look-at where the head turns within about 35 degrees. `love` shows as `happy` until bodies carry a blush, and `thinking` has no face of its own yet.

### The drive

Given a speed and whether the body is on the ground, `drive` picks a clip and its playback rate so a planted foot stays planted, from the walk speed a body's file gives as `walk_speed_m_s`. It holds a walk between half and 2.5 times its own pace; past that the feet slide, so travelling faster needs a faster clip. It only draws. In Terrakin the steps come from `walk.ts` and `Motion`, already checked by the server; the drive never moves anyone.

### For games, outside Terrakin

A separate entry point that Terrakin's world doesn't import: a mover (a position advanced on a fixed step from a direction, a hop, or a flap, against a ground function and boxes), keys and a touch stick turned into the same intent, follow and orbit cameras, and a photo rendered to PNG. A fixed step and a seeded random source let a game replay a run from its inputs.

### For assistants: shots

An assistant should be able to make something with a body and hand it to its person: a picture, a short clip, a loop to post. It does that by writing a shot, which is data and never code.

A shot names a stage, the bodies on it and where each stands, a camera, a length, a frame shape (1:1, 4:5, 9:16), and a timeline of beats: play a clip, show a feeling, look at the camera or at another body, walk to a spot, show a caption. Every value is a name from a list or a number inside a cap. The package checks a shot the way it checks a body file, and plays it on a fixed step with each body's phase taken from its id, so the same shot gives the same frames anywhere.

Three ways to turn a shot into something to share, cheapest first:

1. A link. The shot rides in the link, a page plays it, and the person saves the picture or the clip from there. Nothing is rendered on a server, so it costs nothing to run.
2. A command, for an assistant with a shell: it plays the shot in a headless browser and writes a PNG or an MP4.
3. A route that renders on a server and answers with a file, for an assistant that can only call an API. It spends money, so it comes last, behind a rate limit and a budget with a test that shows each refuses.

A partner's own page can host the first, and say so where its characters learn what they can do.

### Publishing

A tag `figure-v<version>` publishes through npm's trusted publishing, with no stored token (decision 0253). Before 1.0 a minor version can break anything.

## Invariants

- **Server decides:** the package draws. It has no way to import the sim or send a command, and in Terrakin only the server says where anyone is and which body they have.
- **Determinism:** nothing here is in the log. The mover's fixed step is for games outside Terrakin and never runs in the world.
- **Untrusted data:** a body file is outside data. The check and the loader trust none of its shape, ignore every name they don't know, and never show its text.
- **Protocol:** unchanged by this RFC. RFC 0012's `body` field is the only wire change, and it is that RFC's.

## Economy impact

None.

## Security considerations

- **A hostile file:** `glbJson` caps how much JSON it parses and refuses anything that isn't a version 2 `.glb`. `checkBody` never throws on a wrong shape and returns only names made of letters, digits, and underscores, so a file can't put text in front of a person or an AI through a report. Tests cover both.
- **A heavy file:** limits are the caller's and are checked before anything is drawn. The server checks before it stores (RFC 0012); a client checks again before it loads.
- **The supply chain:** releases come only from the workflow, from a tag on this repo, with npm's provenance attached. No token exists to leak. The package has no dependencies of its own beyond three.js as a peer.
- **A shot from an assistant:** it is outside data, like a body file. It can name only stages, clips, and feelings from the package's lists and bodies from sources the host allows, never a URL of its own. Length, size, and the number of bodies are capped before anything is drawn. A caption is drawn as text, capped in length, and never parsed, and a page that plays a shot from a link says the words are the sender's.
- **Outside readers:** anyone can read and run this code. It holds no secret and reaches no Terrakin route.

## Agent experience

Nothing changes for an assistant. `SKILL.md` is untouched.

## Migration and rollout

1. The spec and the check, published as 0.0.1, and the feeling names as 0.0.2.
2. The rigged body, feelings, life at rest, and the drive, as 0.1.0, with a demo page (`pnpm --filter @terrakin/figure demo`).
3. RFC 0012 built on it: the server checks a partner's file with `checkBody`, and `scene3d/figure.ts` asks the package for a body.
4. The paper body.
5. The game entry point.
6. Shots: the format and its check, the page that plays one from a link, then the command. The server route waits until the first two are in use.

No log replays differently at any step, and a client that never loads a body is unchanged.

## Alternatives considered

- **Write the loader in `packages/client` and copy it elsewhere.** The fastest start, and two copies by the second week.
- **Publish from a separate repo.** Keeps this repo all private, but the loader's first and hardest user is this client, and changing both in one commit is worth more.
- **Adopt VRM as the spec.** VRM fixes a humanoid skeleton and its own expression names, which fit a person better than a plush with wings and antennae. A VRM body can be mapped onto this spec by an adapter later, which is the cheap way in for collections that already have VRMs.
- **Ship no flat body.** Then a partner's characters appear only as fast as their models are made, and most of a collection stays a peg for months.

## Open questions

1. RFC 0012 caps a body at 150 KB, 1,500 triangles, one material, and one 256 px texture. MUSEGOD's first real `lo` body is 194 KB, 2,748 triangles, 2 materials, and 3 textures. Either the caps move or the files do.
2. Whether a paper body is a partner perk in Terrakin, so a linked character looks like itself before its model exists. It fits RFC 0012's caps as a 256 px picture. RFC 0007 asks that maintainers other than Ryan approve partner perks.
3. Whether the game entry point and shots belong in this package or in a second one that depends on it.
4. RFC 0012 and RFC 0013 are still marked draft in this folder, and both are built on here.
