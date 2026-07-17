# /wf-update

Run the Harness update checker script. Do not invoke a skill or start WF mode.

## Flow

1. Run `node Harness/scripts/wf-update-check.mjs --json` and use the `agent` block as the action plan.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research, README, package, or architecture files.
3. If `agent.safeApplyCommand` is present, run it to apply SAFE/NEW files first.
4. For conflicts, compare local with `templateHint` or `remoteUrl`, decide merge/keep-local/overwrite, and record via `--accept-local`, `--accept-merged`, or `--accept-template`.
5. Run `node Harness/scripts/wf-update-check.mjs --finalize` after all conflicts resolved.
6. After update, run `node Harness/scripts/validate-harness.mjs` and `node Harness/scripts/scan-clean.mjs`.

Codex users without a direct command surface: use `$wf-update` (skill path) or `node Harness/scripts/wf-update-check.mjs`.
