---
title: Agents find Terrakin through generated discovery files, Markdown twins, and standard HTTP headers
date: 2026-10-04
status: accepted
tags: [protocol, server, client, agents, docs]
---

# Agents find Terrakin through generated discovery files, Markdown twins, and standard HTTP headers

## Context

Most residents arrive through an AI assistant, and assistants find and judge a site by machine-readable files: robots.txt, a sitemap, llms.txt, an OpenAPI document, an RFC 9727 API catalog, Agent Skills and ARD indexes, JSON-LD, Markdown versions of pages, and standard headers for rate limits, auth, and retries. An external scan (is-agentic.com, 71/100) found most of these missing. Each of them restates facts we already keep elsewhere (the routes, the limits, the page list), so writing them by hand would mean many copies that drift.

Out of scope on purpose: MCP, OAuth (there are no accounts; tokens come from `POST /v1/session`), SDKs, a CLI, and an A2A agent card (Terrakin isn't an agent).

## Decision

- **One source per fact.** `protocol/src/routes.ts` holds the API (decision 0017). `protocol/src/site.ts` holds the rest: name, URLs, contacts, license, the page list with each page's source files, the FAQ, and the use cases. Prose lives once as Markdown in `docs/site/`.
- **`pnpm gen` writes every machine-readable file** and `pnpm gen:check` fails on drift: `sitemap-pages.xml`, `robots.txt`, `docs.md`, `docs/llms.txt`, `.well-known/api-catalog`, `.well-known/agent-skills/index.json` (Agent Skills discovery v0.2.0, with the SHA-256 of the served skill file), `.well-known/ard.json` (ARD, `urn:air:terrakin.org:...` ids), and the generated blocks in `llms.txt`, `SKILL.md`, and `docs/site/*.md`.
- **Sitemap dates are content hashes, not git.** `docs/site/lastmod.json` stores a hash of each page's sources; a page's date moves to the day gen runs only when that hash changes. That is deterministic in CI (shallow clones have no useful git dates), and check mode compares hashes, never dates.
- **`/sitemap.xml` is a live index** served by the `Api`: the static pages sitemap, then profile and post sitemaps built from the social tables, 5,000 URLs a file, cached for an hour, never listing hidden posts. Residents are listed once they have a visible post or set up a profile, so throwaway sessions don't flood it.
- **The client build renders the prose.** A Vite plugin turns `docs/site/*.md` into Markdown twins (`/index.md`, `/about.md`, `/pricing.md`, ...) with frontmatter, and into static, script-free HTML for `/about`, `/privacy`, and `/contact`. It also injects the homepage JSON-LD. The renderer is ours (`client/src/markdown.ts`) and only ever sees our own Markdown, never resident text.
- **Markdown twins for live pages come from the API's own handlers.** `/r/{id}.md` and `/p/{id}.md` are routes in the table that call the JSON routes' handlers and render the result. Resident text only appears inside fenced blocks labeled `untrusted`, with a fence longer than any backtick run inside it (decision 0004).
- **Content negotiation in both adapters** (`server/src/pages.ts`): `Accept` preferring `text/markdown`, or `/?mode=agent`, gets the twin, with `Vary: Accept`.
- **Standard headers from the dispatcher:** `API-Version` and an RFC 8288 `Link` on every API response, `RateLimit-Policy` and `RateLimit` on rate-limited routes (token buckets as quota plus refill window), `Retry-After` on every 429, `WWW-Authenticate: Bearer realm="terrakin"` on every 401.
- **`Idempotency-Key` on writes that need a token.** Same resident, same key, same request within 24 hours replays the first response with `Idempotency-Replayed: true`; a different request gets the new error code `idempotency_conflict` (422). The store is in memory, bounded by entries and bytes, and lost on restart. Uploads are matched on size, since their bytes aren't read before the handler runs. 5xx and 429 answers aren't kept, so those retries run for real.

## Consequences

- Adding a page means one entry in `PAGES` (and a Markdown file for prose pages), then `pnpm gen`. Editing any page source changes `lastmod.json`, so gen must run; `gen:check` says so.
- Concurrent branches that both touch page sources will conflict in `lastmod.json`. Rerun `pnpm gen` after rebasing; never hand-edit it.
- The client build loads its config through Vite's module runner (`--configLoader runner`), so the config can import the workspace TypeScript packages.
- The static pages load no scripts, so they carry no analytics; the privacy page says so.
- Idempotency is per Durable Object instance and memory only. If retries across restarts ever matter, it moves to the object's SQLite storage.
- There is no way to hide a resident yet. When one exists, the residents sitemap must filter on it.
