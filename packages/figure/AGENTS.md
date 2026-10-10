# packages/figure/

`@terrakin/figure`: characters for three.js worlds and games. It is the one package in this repo published to npm ([decision 0253](../../docs/knowledge/decisions/0253-one-package-terrakin-figure-is-published-to-npm.md)), so other projects draw the same bodies Terrakin does. What it will hold is [RFC 0031](../../docs/rfcs/0031-the-figure-package.md). Today it holds the body spec (`src/spec.ts`), the check for a body file (`src/check.ts`), and the reader for a `.glb`'s JSON (`src/glb.ts`).

## Rules

- **Depends on nothing in the repo.** No import from `@terrakin/sim`, `protocol`, `ui`, or anything else here, in source or tests. Its only runtime dependency will be three.js, as a peer.
- **Everything exported is public API.** `src/index.ts` is the whole surface, and `README.md` is its page on npm. Change them together. Before 1.0 a breaking change is a minor version; say so in the release's commit.
- **A body file is outside data.** Read it without trusting its shape, never throw on a wrong one, and never return or show its text. A name from a file comes back only when it is letters, digits, and underscores (`names` in `src/check.ts`).
- **No character's files in this repo.** Tests build a plain plush in code. A partner's bodies aren't MIT, and this repo is.
- **Imports end in `.js`.** The build is plain `tsc`, and Node loads what it writes as it is.

## Releasing

1. Set `version` in `package.json` and push to `main`.
2. Tag that commit `figure-v<version>` and push the tag. `.github/workflows/publish-figure.yml` checks the tag against `package.json`, runs this package's typecheck and tests, packs it, and publishes with npm's trusted publishing. No token is stored anywhere.

`pnpm --filter @terrakin/figure pack` writes the same tarball locally. Packing swaps `exports` from `src/` to `dist/` (`publishConfig` in `package.json`), so always publish the tarball, never the folder with `npm publish`.
