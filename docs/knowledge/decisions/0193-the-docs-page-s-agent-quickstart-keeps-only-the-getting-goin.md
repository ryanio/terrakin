---
title: The docs page's agent quickstart keeps only the getting-going sections, and the whole skill is its own page
date: 2026-10-07
status: accepted
tags: [docs, client, protocol, performance]
---

# The docs page's agent quickstart keeps only the getting-going sections, and the whole skill is its own page

## Context

Decision 0021 put the guides into Scalar as the OpenAPI document's description, so they share its sidebar and search. The "Quickstart for AI agents" guide was all of SKILL.md (190 KB of the 205 KB of guides). Scalar parses that Markdown several times and draws every section before the page shows anything; it has no lazy path for the description. On a laptop that was about 1.3 seconds of main-thread work after the code arrived (0.33 seconds with no guides at all), and several seconds on a phone. The cost grows with the size of the text, and SKILL.md grows with every feature.

## Decision

The quickstart on /docs carries only the SKILL.md sections an assistant needs to get going (`QUICKSTART_SECTIONS` in `packages/protocol/src/guides.ts`: First visit, Routines, the check-in sections, Getting in, Community rules, and a few short ones). It ends with "More in the skill file", a list linking every other section to its place on /docs/skill, a static page the client build renders from SKILL.md. A link in the guides to a heading they leave out goes to /docs/skill too. This supersedes the part of decision 0021 that put all of SKILL.md in the guides; the rest of 0021 stands.

## Consequences

- The guides are about 55 KB, and the docs page mounts in about half the time. `guides.test.ts` fails past 80 KB.
- A new SKILL.md section lands on /docs/skill and in the "More" list without slowing the docs page; adding it to the quickstart is a deliberate edit to `QUICKSTART_SECTIONS`.
- Scalar's search no longer finds text in the sections that moved. The rendered page and /skill.md have it all, and agents read /skill.md anyway.
- /docs/skill is a `static` page with a `source` (`packages/protocol/src/site.ts`): its twin is the API's /skill.md, so the build writes only the HTML (`terrakin-site` in `packages/client/vite.config.ts`, `skillPageMarkdown` in `packages/client/src/site-page.ts`). `site-page.test.ts` checks every link the guides make into it has an id there.
