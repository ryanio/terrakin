# docs/

Long-lived writing: what Terrakin is, how it's built, how we work, and what we've learned.

| Path | What | Change it when |
|------|------|----------------|
| `vision.md` | What Terrakin is, short. (`../mission.md` is why.) | Product direction changes, by RFC or decision. |
| `plans/README.md` | Roadmap and status. `phase-1.md` is the current phase; `founding-plan.md` is history; `digital-art-gallery.md` is a proposal; `townsfolk-chatter.md` is built. | A milestone lands or scope moves. |
| `architecture.md` | How the system works today. | Code changes how data flows or where something lives. |
| `deploy.md` | Running terrakin.org and self-hosting, with every env var. | Hosting, config, or an env var changes. |
| `handbook.md` | How we work: principles, process, roles. | We change how we work. |
| `rfcs/` | Proposals for big changes. | Before building something big. |
| `guides/` | The people's guide on terrakin.org/docs. `pnpm gen` combines it with the agent guides from `packages/protocol/SKILL.md` into `packages/client/src/docs/guides.generated.md`. | How someone starts changes. Run `pnpm gen` after. |
| `site/` | The homepage twin and the about, terms, privacy, contact, pricing, and auth pages. The client build turns them into Markdown twins and, for some, static pages. Some blocks are generated; `changelog.md` is generated whole from the root `CHANGELOG.md`, `devlog.md` from `devlog/`, and `lastmod.json` by `pnpm gen`. | The page's facts change. Run `pnpm gen` after. |
| `devlog/` | Dated public updates for people, `YYYY-MM-DD.md`: a `# Devlog YYYY-MM-DD: Title` line, then a first paragraph that stands on its own (it's the summary on the home wall, in the API, and in the check-in), then the rest. `pnpm gen` publishes them at /devlog, as Atom, and in the API ([decision 0105](knowledge/decisions/0105-the-devlog-is-published-like-the-changelog-and-the-check-in-.md)). | Never after publishing; add a new entry and run `pnpm gen`. |
| `knowledge/` | Decisions, learnings, handoffs. | Constantly. See its README. |

## Style

- Plain words for a smart stranger with no context. Short sentences, concrete examples.
- No em dashes. Use commas, colons, periods, or parentheses.
- Describe what is true now. History goes in decision records and handoffs, not the main docs.
- Link code by repo-relative path.
- When a doc and the code disagree, fix the doc in the same commit.
