---
title: The client build leaves out zod's JSON Schema code and draws avatar figures from a chunk loaded beside the first load
date: 2026-10-08
status: accepted
tags: [client, performance, tooling]
---

# The client build leaves out zod's JSON Schema code and draws avatar figures from a chunk loaded beside the first load

## Context

The first load had 0.1 kB left under its 140 kB budget ([decision 0110](0110-the-first-page-load-has-a-gzipped-size-budget-the-build-enfo.md)). Moving two helpers out of page modules (the letter image check and the Visit tap) brought it to 135.0 kB. The biggest pieces left were:

- The figure drawing (`packages/ui/src/figure.ts`), about 11.6 kB gzipped. Only avatars of residents with a look need it, and none is drawn before the feed's own request comes back.
- zod's JSON Schema code (`to-json-schema.js` and `json-schema-processors.js`), about 5 kB. Every classic schema type hooks it in when it's built, so tree shaking can't drop it, but the app never asks a schema for JSON Schema. Moving the protocol to `zod/mini` would drop it too, at the cost of rewriting about 2,100 schema calls.
- The devlog card and its Markdown renderer, about 3.5 kB. Loading them with `import()` measured no smaller: the bundler split the modules they share with the feed into six more chunks, and their overhead ate the saving. So they stay.

## Decision

- `people.ts` starts loading `figure.ts` with `import()` as soon as it runs, beside the feed's request, and an avatar with a look paints its figure when the module is there. Until then it shows its colored disc. `hasLook` and `hairOf` moved to `looks.ts`, so deciding whether an avatar has a figure needs no drawing code.
- The client build runs `noJsonSchema` (`packages/client/vite.config.ts`): zod's classic schemas get stand-ins for its two JSON Schema modules, written by `src/no-json-schema.ts`. `aggregateChecks`, which a schema's `minLength` and similar getters read, is the real one; every other name is a function that throws if called. Parsing never calls them.
- Together with the two moved helpers the first load is 119.5 kB of gzipped script, from 139.9 kB. The budget follows it down to 125 kB.

## Consequences

- An avatar with a look can paint a moment after its disc on a slow connection's first visit. After that the module is cached and figures paint at once.
- Code in the app that calls `toJSONSchema`, or `~standard.jsonSchema`, throws in the build but works in tests. None does. The server and the OpenAPI generator don't use this build.
- A zod upgrade that moves these modules or starts using a processor while parsing shows up as a build error (a missing export) or in `pnpm e2e` (every page parses responses). If the stand-ins stop applying, the first load grows by about 5 kB and the budget says so.
