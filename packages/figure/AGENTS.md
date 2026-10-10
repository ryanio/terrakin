# packages/figure/

`@terrakin/figure`: characters for three.js worlds and games. It is the one package in this repo published to npm ([decision 0253](../../docs/knowledge/decisions/0253-one-package-terrakin-figure-is-published-to-npm.md)), so other projects draw the same bodies Terrakin does. What it will hold is [RFC 0031](../../docs/rfcs/0031-the-figure-package.md).

## Layout

Two entries, so a server or the feed can use the rules without loading three.js:

- `src/index.ts`, the main entry, with no dependencies: the body spec (`spec.ts`), the check for a body file (`check.ts`), the reader for a `.glb`'s JSON (`glb.ts`), the feeling names (`feelings.ts`, which `packages/ui/src/feelings.ts` passes on to the client), what each feeling asks of a body and which clip stands in for a missing one (`feel.ts`), blinks, breath, and a body's own offset (`rest.ts`, whose `idPhase` the client's figures use too), and the clip for how a body is moving (`drive.ts`).
- `src/three.ts`, the `./three` entry, which imports three.js: `loadBody` and the `Body` it returns. `RiggedBody` plays clips on a mixer, eases face keys, blinks, turns the head after the mixer has run, and makes a bob or a hop in code for a body without the clip.
- `src/test-support.ts` writes a plain plush out as a `.glb` for tests: one triangle, two bones, a face, and clips a test can tell apart. It isn't built into `dist/`.
- `demo/` is a page to look at a body: `pnpm --filter @terrakin/figure demo`, then http://localhost:5175. It loads a plain plush built in code (`demo/plush.ts`) or a `.glb` dropped on it, with a button for each clip and feeling, a speed to walk at, and a pointer to look at. It isn't published.

## Rules

- **Depends on nothing in the repo.** No import from `@terrakin/sim`, `protocol`, `ui`, or anything else here, in source or tests. three.js is a peer, and only `src/three.ts` and `demo/` import it.
- **The main entry never imports three.js**, not even through another file. The server and the feed import it.
- **Everything exported is public API.** `src/index.ts` and `src/three.ts` are the whole surface, and `README.md` is its page on npm. Change them together. Before 1.0 a breaking change is a minor version; say so in the release's commit.
- **A body file is outside data.** Read it without trusting its shape, never throw on a wrong one from the check, and never return or show its text. A name from a file comes back only when it is letters, digits, and underscores (`names` in `src/check.ts`). A parser's or loader's own error can quote the file, so it is replaced with our words (`glbJson`, `loadBody`).
- **No character's files in this repo.** Tests and the demo build a plain plush in code. A partner's bodies aren't MIT, and this repo is.
- **Imports end in `.js`.** The build is plain `tsc`, and Node loads what it writes as it is.
- **Tests run without WebGL.** three's loader and mixer run under Node, so `three.test.ts` loads the plush and asserts what a scene would see: where the head points, how far a face key is held, whether the body is off the ground. Look at the demo after any change to how a body moves; a test can't judge that.

## Releasing

1. Set `version` in `package.json` and push to `main`.
2. Tag that commit `figure-v<version>` and push the tag. `.github/workflows/publish-figure.yml` checks the tag against `package.json`, runs this package's typecheck and tests, packs it, and publishes with npm's trusted publishing. No token is stored anywhere.

`pnpm --filter @terrakin/figure pack` writes the same tarball locally. Packing swaps `exports` from `src/` to `dist/` (`publishConfig` in `package.json`), so always publish the tarball, never the folder with `npm publish`. npm takes a few minutes to serve a new version.
