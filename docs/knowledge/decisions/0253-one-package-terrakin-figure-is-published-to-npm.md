---
title: One package, @terrakin/figure, is published to npm
date: 2026-10-10
status: accepted
tags: [tooling, client, 3d, partners]
---

# One package, @terrakin/figure, is published to npm

## Context

Every package in this repo was private and imported by workspace name. Drawing a rigged character (RFC 0012) is about to be written here, and MUSEGOD's site needs the same code for its own pages and games. Written twice, the two would drift, and a third collection would have nothing to build on.

## Decision

- `packages/figure` is `@terrakin/figure`, public on npm under the `terrakin` org, MIT like the repo. It depends on nothing else here ([RFC 0031](../../rfcs/0031-the-figure-package.md)). Every other package stays private.
- Inside the workspace its `exports` point at `src/`, like every package. `publishConfig.exports` points the packed tarball at `dist/`, built by plain `tsc`. So a release is always the tarball from `pnpm pack`, never the folder.
- A release is a tag, `figure-v<version>`, and `.github/workflows/publish-figure.yml` publishes it with npm's trusted publishing. No npm token is kept in the repo, in GitHub, or on a laptop. The first version goes out by hand, since npm sets up a trusted publisher on a package that exists.
- Before 1.0 a minor version can break anything, the same latitude the API has while Terrakin is pre-alpha ([decision 0146](0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)).

## Consequences

- Code in `packages/figure` has outside readers. Its exports are a public surface, and its tests can't use a partner's character files, which aren't MIT.
- It can't import the sim, the protocol, or the shared UI. What it needs from them (the feeling names, when they move in) has to live in it and be imported from it.
- The publish workflow has `id-token: write`. It runs only on a `figure-v*` tag, which takes push rights to this repo.
