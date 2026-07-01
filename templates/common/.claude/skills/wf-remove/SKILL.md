---
name: wf-remove
description: Use for /wf-remove in Claude Code, $wf-remove or /skills wf-remove in Codex, or any request to uninstall Harness safely.
---

# WF Remove Adapter

## Invocation

- Claude Code: use `/wf-remove` or select the `wf-remove` skill.
- Codex CLI or IDE: use `$wf-remove` or `/skills` then choose `wf-remove`.

## Load

- `Harness/.harness-version`
- `Harness/scripts/wf-remove.mjs`

## Flow

1. Run `node Harness/scripts/wf-remove.mjs --json` for the machine-readable
   plan.
2. Auto-remove only SAFE files that still match stored checksums.
3. Ask the user before every MODIFIED or uncertain file.
4. Preserve USER DATA by default. For an explicit thorough uninstall, use
   `--purge-user-data` (alias `--purge`); add `--keep-tasks` when the user wants task records
   retained while project-fact Harness docs are removed.
5. Run the script, not manual deletes:
   - safe default: `node Harness/scripts/wf-remove.mjs --apply --yes`
   - thorough but keep tasks: `node Harness/scripts/wf-remove.mjs --apply --yes --purge-user-data --keep-tasks`
   - exact modified decisions: add `--delete-modified <path>` for each
     user-approved MODIFIED file.

## Return

Report SAFE removals, MODIFIED keep/delete decisions, preserved USER DATA,
PURGE removals, directory cleanup, CLAUDE/AGENTS status, `.harness-version`
status, and `git status` guidance.
