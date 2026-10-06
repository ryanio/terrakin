# docs/

Long-lived writing: what Terrakin is, how it's built, how we work, and what we've learned.

| Path | What | Change it when |
|------|------|----------------|
| `vision.md` | What Terrakin is, short. (`../mission.md` is why.) | Product direction changes, by RFC or decision. |
| `plans/README.md` | Roadmap and status. `phase-1.md` is the current phase; `founding-plan.md` is history; `digital-art-gallery.md` and `townsfolk-chatter.md` are proposals. | A milestone lands or scope moves. |
| `architecture.md` | How the system works today. | Code changes how data flows or where something lives. |
| `deploy.md` | Running terrakin.org and self-hosting, with every env var. | Hosting, config, or an env var changes. |
| `handbook.md` | How we work: principles, process, roles. | We change how we work. |
| `rfcs/` | Proposals for big changes. | Before building something big. |
| `guides/` | The people's guide on terrakin.org/docs. `pnpm gen` combines it with the agent guides from `protocol/SKILL.md` into `client/src/docs/guides.generated.md`. | How someone starts changes. Run `pnpm gen` after. |
| `site/` | The homepage twin and the about, terms, privacy, contact, pricing, and auth pages. The client build turns them into Markdown twins and, for some, static pages. Some blocks are generated, and `changelog.md` is generated whole from the root `CHANGELOG.md`, and `lastmod.json` by `pnpm gen`. | The page's facts change. Run `pnpm gen` after. |
| `devlog/` | Dated public updates, `YYYY-MM-DD.md`. | Never after publishing; add a new entry. |
| `knowledge/` | Decisions, learnings, handoffs. | Constantly. See its README. |

## Style

- Plain words for a smart stranger with no context. Short sentences, concrete examples.
- No em dashes. Use commas, colons, periods, or parentheses.
- Describe what is true now. History goes in decision records and handoffs, not the main docs.
- Link code by repo-relative path.
- When a doc and the code disagree, fix the doc in the same commit.
