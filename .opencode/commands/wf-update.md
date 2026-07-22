# /wf-update

Run the Harness update checker script. Do not invoke a skill or start WF mode.

## Classification

MANIFEST-FIRST. The installer and updater read `Harness/ownership.manifest.json`:

- `preserve[]` — never touched (tasks, memory, research, root README, package, architecture). `Harness/tasks/**` is always preserved.
- `merge[]` — CLAUDE.md, AGENTS.md, MEMORY.md, Harness/MEMORY.md, Harness/README.md → merge or accept-local; prior accepted decisions carry forward.
- `frameworkOwned[]` — safe overwrite-upgrade fast path (concurrent fetch + hash + all-or-nothing write after checksum validation).
- `optionalOwned[]` — upgraded only when that option is installed.

Content markers (`harness: wf-agent`, `project harness`, `Harness/...`) are the FALLBACK when no manifest exists (old installs) and the instance-ownership signal that protects a user's same-name file at a Harness path. A same-name user file with no marker and no manifest declaration → conflict/skip + warning, never overwritten.

## Flow

1. Run `node Harness/scripts/wf-update-check.mjs --json` and use the `agent` block as the action plan. Current updaters try npm `create-harness-vibe-coding@latest` first, then the canonical GitHub source `LiWeny16/create-harness-vibe-coding`, then the legacy compatibility mirror `zingspark/create-harness-vibe-coding`.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research, root README.md, package, or architecture files. Harness/README.md is merge-tier, not PRESERVE.
3. If `agent.safeApplyCommand` is present, run it to apply SAFE/NEW/adopted (metadata-only) files first. Framework-owned templates, commands, skills, agents, and scripts are script-owned and should be overwritten by the updater after checksum validation.
4. For conflicts, compare local with `templateHint` or `remoteUrl`, decide merge/keep-local/overwrite, and record via `--accept-local`, `--accept-merged`, or `--accept-template`. Previously accepted decisions for any merge-tier file (CLAUDE.md, AGENTS.md, MEMORY.md, Harness/MEMORY.md, Harness/README.md) are carried forward automatically when both the local hash and remote template hash are unchanged.
5. If a new agent/command/skill path collides with an existing file, do not decide by filename alone. Treat it as Harness-owned only when the file content has Harness/WF markers such as `harness: wf-agent`, `project harness`, or `Harness/...`; otherwise leave it as a real conflict.
6. Run `node Harness/scripts/wf-update-check.mjs --finalize` after all conflicts resolved.
7. After update, run `node Harness/scripts/validate-harness.mjs` and `node Harness/scripts/scan-clean.mjs`.

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
