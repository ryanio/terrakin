@AGENTS.md

## Claude Code notes

- Repo skills in `.claude/skills/`: `capture-knowledge`, `handoff`, `write-rfc`, `ship`, and `steward` (driving a PR to green). Use them instead of improvising those workflows. The secrets skill is shared with other agents, so it lives in `.agents/skills/secrets/` and Claude Code doesn't list it: read its `SKILL.md` before you need a key.
- `.claude/agents/reviewer.md` is a read-only reviewer that checks a diff against the rules above. Run it on risky diffs before pushing.
- In cloud sessions, `.claude/hooks/session-start.sh` installs dependencies.
- Every folder with an `AGENTS.md` has a `CLAUDE.md` that imports it, so its rules load when you work there.
