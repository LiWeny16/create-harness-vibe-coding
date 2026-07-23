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

- Normal agent sessions start from `CLAUDE.md`.
- Use `Harness/SETUP.md` only for install/bootstrap guidance, migration, upgrade decisions, or explicit setup requests.
- Use `Harness/README.md` as the Harness workflow router when a routed task needs it.
- Load memory and resource registrations from `Harness/MEMORY.md` only when routed.
- Track active work in `Harness/PROGRESS.md` and `Harness/tasks/<task-id>/PROGRESS.md`.
- Use `Harness/WF.md` only when the user explicitly invokes a WF command such as `/wf` or `/wf-max`; complex work may still use direct planning, tests, and subagents without entering WF.
  - Claude Code: invoke the `wf` skill with `/wf`.
  - Codex: invoke the `wf` skill with `$wf` or `/skills`.
- Use `Harness/subagents.md` when coordinating multiple agents.

Tool discovery files stay at the repository root:

- Claude Code: `.claude/settings.json`, `.claude/agents/`, and `.claude/skills/`.
- Codex: `.agents/skills/` for repo skills and `.codex/` for config placeholders. The bundled update reminder uses a startup-only hook; avoid turn-by-turn runtime hooks unless `/wf-auto` explicitly opts into a bounded tick hook.
