---
name: wf-update
description: Use for /wf-update in Claude Code, $wf-update or /skills wf-update in Codex, or any request to check for or apply Harness scaffold updates.
---

# WF Update Adapter

## Invocation

- Claude Code: use `/wf-update` or select the `wf-update` skill.
- Codex CLI or IDE: use `$wf-update` or `/skills` then choose `wf-update`.

## Load

- `Harness/.harness-version`
- `Harness/scripts/wf-update-check.mjs`
- `Harness/scripts/scan-clean.mjs`
- `Harness/scripts/validate-harness.mjs`

## Flow

1. Run `node Harness/scripts/wf-update-check.mjs` first.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research,
   README, package, or architecture files.
3. Apply SAFE and NEW files through the script.
4. Ask the user before every CONFLICT file: merge, overwrite, or keep.
5. After update, run the validator and then scan-clean.

## Return

Report version, SAFE/NEW updates, conflicts and decisions, preserved files,
validation output, scan-clean result, and remaining risks.
