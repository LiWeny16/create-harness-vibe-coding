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

1. Run `node Harness/scripts/wf-remove.mjs` for a dry-run plan.
2. Auto-remove only SAFE files that still match stored checksums.
3. Ask the user before every MODIFIED or uncertain file.
4. Never remove USER DATA files.
5. Run `node Harness/scripts/wf-remove.mjs --apply` only after the plan is
   understood and modified-file decisions are clear.

## Return

Report SAFE removals, MODIFIED keep/delete decisions, preserved USER DATA,
directory cleanup, CLAUDE/AGENTS status, and `git status` guidance.
