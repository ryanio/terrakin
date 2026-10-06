---
name: write-rfc
description: Draft a Terrakin RFC in docs/rfcs for a big change (new game system, economy, protocol version, storage, identity, security model, or a rule change that alters how existing world logs replay). Use when the user proposes such a change or asks for an RFC or design doc.
---

# Write an RFC

## Before writing

1. Read `mission.md`, `docs/vision.md`, the relevant sections of `docs/plans/founding-plan.md`, `docs/architecture.md`, and `docs/rfcs/README.md`.
2. Check `docs/knowledge/INDEX.md` for decisions this would touch or supersede.
3. Skim the code the change affects, so the design is grounded in what exists.

## Writing

1. Copy `docs/rfcs/TEMPLATE.md` to `docs/rfcs/NNNN-short-title.md`, numbered past the newest RFC on `origin/main` (run `git fetch` first; `pnpm kb:check` fails when two RFCs share a number). Add it to the index table in `docs/rfcs/README.md` with status `draft`.
2. Fill every section. The required ones are not optional:
   - **Invariants**: say how server authority, determinism, untrusted chat, and protocol compatibility are preserved.
   - **Security considerations**: real abuse cases, including prompt injection through chat or names.
   - **Economy impact**: new sources and sinks; how duplication and inflation are prevented.
   - **Agent experience**: what changes in `protocol/SKILL.md`.
   - **Migration**: does this change how existing logs replay?
3. Prefer concrete examples (JSON messages, command shapes) over prose.
4. List real alternatives and why they lost.
5. Put anything unresolved in **Open questions** rather than guessing.

## After

An RFC is a proposal. Don't mark it accepted yourself; a maintainer does that on the PR. Once accepted, record the key choices with `capture-knowledge`.
