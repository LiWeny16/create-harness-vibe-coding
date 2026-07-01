# {{projectName}}

Project development notes belong here.

## Development Commands

Record the real project commands after bootstrap:

```bash
# Install dependencies
# e.g. npm install

# Run locally
# e.g. npm run dev

# Run tests
# e.g. npm test

# Build
# e.g. npm run build
```

Replace the examples with the real commands discovered from this project. If a command is unknown, record the open question in `Harness/tasks/<task-id>/PROGRESS.md`.

## Git And Release Notes

- Keep branch, commit, pull request, CI, and release conventions in this README.
- Do not place build scripts, git policy, or project maintenance instructions in `CLAUDE.md`.
- Keep code architecture notes in `Harness/architecture.md` or feature docs.
- For README improvements, use `.claude/skills/wf-readme/SKILL.md`; preserve public docs unless a rewrite is approved.

## Harness

The agentic engineering harness lives in `Harness/`.

- Follow `Harness/SETUP.md` before normal work while it exists.
- Start at `Harness/README.md`.
- Load memory and resource registrations from `Harness/MEMORY.md`.
- Track active work in `Harness/PROGRESS.md` and `Harness/tasks/<task-id>/PROGRESS.md`.
- Use `Harness/WF.md` for long, difficult, multi-agent work.
  - Claude Code: invoke the `wf` skill with `/wf`.
  - Codex: invoke the `wf` skill with `$wf` or `/skills`.
- Use `Harness/subagents.md` when coordinating multiple agents.

Tool discovery files stay at the repository root:

- Claude Code: `.claude/settings.json`, `.claude/agents/`, and `.claude/skills/`.
- Codex: `.agents/skills/` for repo skills and `.codex/hooks.json` for hook/config integration.
