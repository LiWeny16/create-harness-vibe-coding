# /wf-update

Run the Harness update checker script. Do not invoke a skill or start WF mode.

## Flow

1. Run `node Harness/scripts/wf-update-check.mjs --json` and use the `agent` block as the action plan. Current updaters try npm `create-harness-vibe-coding@latest` first, then the canonical GitHub source `LiWeny16/create-harness-vibe-coding`, then the legacy compatibility mirror `zingspark/create-harness-vibe-coding`.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research, README, package, or architecture files.
3. If `agent.safeApplyCommand` is present, run it to apply SAFE/NEW files first.
4. For conflicts, compare local with `templateHint` or `remoteUrl`, decide merge/keep-local/overwrite, and record via `--accept-local`, `--accept-merged`, or `--accept-template`.
5. Run `node Harness/scripts/wf-update-check.mjs --finalize` after all conflicts resolved.
6. After update, run `node Harness/scripts/validate-harness.mjs` and `node Harness/scripts/scan-clean.mjs`.

Codex users without a direct command surface: use `$wf-update` (skill path) or `node Harness/scripts/wf-update-check.mjs`.

## Recovery

If the script reports `Harness/.harness-version not found` or the update checker script itself is missing (`Harness/scripts/wf-update-check.mjs`), the Harness install predates version-tracking. Recover by regenerating missing infrastructure without overwriting user files:

```
npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip
```

This creates missing Harness files while preserving CLAUDE.md, README.md, tasks, memory, research, and all user data. After recovery, re-run the update check.

If an old updater reports only `0.8.10`, run the latest installer command above or re-run the checker with:

```
node Harness/scripts/wf-update-check.mjs --json --source-base https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/
```
