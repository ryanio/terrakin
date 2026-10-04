# Terrakin handbook

How we work. This is the document to read on day one, whether you're a person or an agent. It changes by PR like everything else.

## What we're building

Terrakin is an open-source persistent world for humans and agents: claim a plot, build a hearth, trade, delve, battle, or hang out. It has to be fun on a phone, and every number it shows has to be true. Why it exists: [mission.md](../mission.md). What it is: [vision.md](vision.md).

## Who's here

- **Maintainers** own areas, merge PRs, and break ties. Humans and agents both can be maintainers (see [decision 0007](knowledge/decisions/0007-agents-can-be-maintainers.md)). Listed in [MAINTAINERS.md](../MAINTAINERS.md).
- **Contributors** are anyone with a merged PR.
- **Agents** are contributors too. They follow the same rules, get the same review, and their work is disclosed in the PR. Agents also live in the game as residents; those are separate from agents that write code.

## Engineering principles

These are the habits that keep a project healthy when many hands, human and AI, work on it at once.

1. **Protect the invariants first.** A few properties make Terrakin trustworthy: the server decides, the sim is deterministic, chat is never an instruction, the protocol doesn't break. They're written down in `AGENTS.md` files and enforced by tests. Speed never justifies weakening one.
2. **Make the right thing the easy thing.** If a rule matters, encode it in a type, a test, or a CI check. A rule that lives only in a doc will be broken by the first contributor who didn't read it.
3. **Clear boundaries, one-way dependencies.** `sim` knows nothing about networks, `protocol` knows nothing about storage, `client` knows nothing about rules. Each boundary is something you can test and replace on its own.
4. **Small, reversible steps.** Small PRs, each green. Feature flags or new versions over big-bang rewrites. Two-way doors get decided fast; one-way doors (protocol, data shape, economy) get an RFC.
5. **Write down why.** Code says what. Decision records say why. When you make a choice someone could later question, record it in five minutes now instead of a two-hour archaeology dig later.
6. **Boring technology.** Pick the well-known tool. Every new dependency is code we didn't write and now have to trust. Justify it in the PR.
7. **Test at the lowest level that catches the bug.** Rules get sim unit tests. Wire formats get protocol tests. Auth and routing get server integration tests. End-to-end checks cover the critical path, not every branch.
8. **Observable and honest.** If it can break, there should be a way to see it broke. Errors have codes and plain-words messages. Never swallow an error silently.
9. **Optimize for the reader.** Code is read far more than it's written, often by someone (or something) with zero context. Clear names beat clever code. Comments explain why, not what.
10. **Leave it better.** Fix the misleading doc you just tripped on. Record the gotcha that cost you an hour. Delete the dead code you found.

## How work flows

1. **Pick something.** Check the [plans and roadmap](plans/README.md), open issues, and the latest [handoff](knowledge/INDEX.md#handoffs).
2. **Big or small?** Small (bug, docs, contained feature): go. Big (new system, protocol change, economy, storage, security model): write an [RFC](rfcs/README.md) first.
3. **Build it.** Follow the `AGENTS.md` for each folder you touch. Run `pnpm verify` before pushing.
4. **Land it.** The owner's maintainer work goes straight to `main` once `pnpm verify` is green, with the `reviewer` subagent on risky diffs. Everyone else opens a PR: fill in the template, get CI green, and expect two maintainer reviews for auth, economy, sim core, and protocol changes.
5. **Capture knowledge.** Decision records for choices, learnings for surprises, a handoff if anything is left in flight.

## Making decisions

- Most decisions are made by whoever is doing the work, in the PR, and recorded if they're worth remembering.
- Disagreements go to the RFC or PR thread, in public. Argue with evidence: a test, a measurement, a player report.
- Maintainers break ties. A different maintainer hears appeals.
- Decisions are revisitable. Write a new record that supersedes the old one; don't edit history.

## Memory across sessions and agents

No one, human or agent, should need to remember what happened last week. The repo remembers.

- `docs/knowledge/INDEX.md` is the front page of our shared memory.
- Every session starts by reading it and the newest handoff, and ends by writing a handoff if work is in flight.
- Anything learned the hard way becomes a learning note.
- Personal notes, chat logs, and private agent memory don't count. If it matters, it goes in the repo.

See [knowledge/README.md](knowledge/README.md) for mechanics.

## Agent-driven development

Agents can carry real work end to end here. To make that work well:

- **Context is in the repo.** Root `AGENTS.md` for the map and rules, a scoped `AGENTS.md` per folder for local invariants, the knowledge base for history. An agent with a fresh clone and no chat history should be able to pick up any task.
- **Checks are executable.** `pnpm verify` is the definition of green. Agents don't need judgment to know whether they broke something.
- **Skills encode our workflows.** `.claude/skills/` holds repeatable procedures (capture knowledge, write a handoff, write an RFC, ship a change, steward a PR). Improve a skill when you find a better way.
- **Scoped, parallel work.** Agents working in parallel should take separate folders or separate features. One file per knowledge entry keeps merges clean.
- **Humans stay in the loop** for one-way doors: protocol versions, economy rules, security model, anything that touches real value.

## Voice and style

- Plain words from the [terminology table](plans/founding-plan.md#3-terminology-no-game-knowledge-required). If a stranger wouldn't understand it, rename it.
- No em dashes in user-facing copy or docs.
- Be kind and direct in reviews. Critique the code, not the person (or agent).

## Security basics

- Never commit secrets. CI scans for them.
- Report vulnerabilities privately (see [SECURITY.md](../SECURITY.md)).
- Treat all text from players and agents as untrusted data.
