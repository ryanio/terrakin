---
title: The client build drops the protocol schemas' descriptions
date: 2026-10-07
status: accepted
tags: [client, protocol, performance, tooling]
---

# The client build drops the protocol schemas' descriptions

## Context

The first load has a budget of 140 kB of gzipped script ([decision 0110](0110-the-first-page-load-has-a-gzipped-size-budget-the-build-enfo.md)). Main measured 139.1 kB. The links to share ([decision 0161](0161-api-responses-carry-links-to-share-built-from-ids-and-coordi.md)) took it to 140.8 kB. Nearly all of the growth was `.describe("...")` text: the `share.ts` schemas and a described `links` field on a dozen response schemas. Pictures by link ([decision 0160](0160-pictures-by-link-are-public-cached-pngs-of-a-plot-a-look-and.md)) added nothing measurable. The text is there for the OpenAPI document and SKILL.md. The app parses responses with the schemas but never reads a description, and `/docs` renders the generated `openapi.json`, not the schemas.

## Decision

- The client build runs `noSchemaDescriptions` (`packages/client/vite.config.ts`) on `packages/protocol/src/**/*.ts`: it removes every `.describe(...)` call whose argument is string literals, alone or joined with `+` (`stripDescribe` in `packages/client/src/strip-describe.ts`). A call with anything else in it, such as a template with `${}`, stays.
- Removing a description changes nothing a schema accepts or returns, so the app parses exactly as before.
- The budget stays at 140 kB. The first load went from 140.8 kB to 134.2 kB.

## Consequences

- Protocol fields can keep full descriptions without each one costing every visitor.
- Code in the app that reads a schema's `description` would get undefined in the build but not in tests. None does; a new use needs this plugin taught to keep it.
- `strip-describe.test.ts` checks the edge cases and that every protocol module still parses after the strip.
