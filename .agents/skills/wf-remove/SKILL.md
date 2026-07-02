---
name: wf-remove
description: Use for /wf-remove in Claude Code, $wf-remove or /skills wf-remove in Codex, or any request to uninstall Harness safely.
---

# WF Remove Adapter

## Invocation

- Claude Code: use `/wf-remove` or select the `wf-remove` skill.
- Codex CLI or IDE: use `$wf-remove` or `/skills` then choose `wf-remove`.
- User-facing removal is the slash/skill command. The Node commands below are
  agent-internal execution steps; do not ask the user to copy/paste them unless
  the agent has no shell/tool access.

## Load

- `Harness/.harness-version`
- `Harness/scripts/wf-remove.mjs`

## Flow

1. On plain `/wf-remove`, run `node Harness/scripts/wf-remove.mjs --json` for
   the machine-readable plan, then run the safe default apply command yourself.
2. Auto-remove only SAFE files that still match stored checksums or exact
   built-in Harness discovery files recognized by the script.
3. Ask the user before every MODIFIED or uncertain file.
4. Preserve USER DATA by default. For an explicit thorough uninstall, use
   `--purge-user-data` (alias `--purge`); add `--keep-tasks` when the user wants task records
   retained while project-fact Harness docs are removed.
5. Run the script yourself, not manual deletes and not user-side command copy:
   - safe default: `node Harness/scripts/wf-remove.mjs --apply --yes`
   - thorough but keep tasks: `node Harness/scripts/wf-remove.mjs --apply --yes --purge-user-data --keep-tasks`
   - exact modified decisions: add `--delete-modified <path>` for each
     user-approved MODIFIED file.
6. After apply, verify residual discovery folders:
   - `.claude/agents`
   - `.claude/skills`
   - `.claude/commands`
   - `.claude/rules`
   - `.agents/skills`
   - `.codex`
   Built-in Harness files in these locations should be gone. Custom user skills
   or user-owned files may remain and must be reported, not blindly deleted.

## Return

Report SAFE removals, MODIFIED keep/delete decisions, preserved USER DATA,
PURGE removals, directory cleanup, `.claude` / `.agents` / `.codex` residual
status, `.harness-version` status, and `git status` guidance.
