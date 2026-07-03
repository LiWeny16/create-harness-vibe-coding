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

1. Run `node Harness/scripts/wf-update-check.mjs --json` first and use the
   `agent` block as the action plan.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research,
   README, package, or architecture files.
3. If `agent.safeApplyCommand` is present, run it to apply SAFE, NEW, and
   adopted metadata-only files before spending AI time on conflicts. Default command:
   `node Harness/scripts/wf-update-check.mjs --apply-safe`.
4. For every `agent.aiMergeRequired` entry, compare the local file with
   `templateHint` or `remoteUrl`, then choose merge, keep-local, or
   overwrite-from-template. Record the decision through the script with
   `--accept-local <file>`, `--accept-merged <file>`, or
   `--accept-template <file>`; do not hand-edit `Harness/.harness-version`.
   Ask the user only when the intent is ambiguous.
5. Run `node Harness/scripts/wf-update-check.mjs --finalize` after all
   conflicts have script-recorded decisions. Use strict `--apply` only when the
   JSON plan has zero conflicts.
6. After update, run the validator and then scan-clean.

## Return

Report version, SAFE/NEW updates, conflicts and decisions, preserved files,
partialUpdate status if any, validation output, scan-clean result, and
remaining risks.
