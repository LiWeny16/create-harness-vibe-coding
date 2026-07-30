# /wf-update

Run the Harness update checker script. Do not invoke a skill or start WF mode.

## Classification

MANIFEST-FIRST. The installer and updater read `Harness/ownership.manifest.json`:

- `preserve[]` - existing user data is never overwritten (tasks, memory, research, root README, package, architecture). Missing scaffold starter files may be created when no local user data exists. `Harness/tasks/**` is always preserved.
- `merge[]` - CLAUDE.md, AGENTS.md, MEMORY.md, Harness/MEMORY.md, Harness/README.md -> merge or accept-local; prior accepted decisions carry forward.
- `frameworkOwned[]` - safe overwrite-upgrade fast path (concurrent fetch + hash + all-or-nothing write after checksum validation).
- `optionalOwned[]` - upgraded only when that option is installed.

Content markers (`harness: wf-agent`, `project harness`, `Harness/...`) are the fallback when no manifest exists (old installs) and the instance-ownership signal that protects a user's same-name file at a Harness path. A same-name user file with no marker and no manifest declaration becomes conflict/skip + warning, never overwritten.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep updater
scripts and ownership docs stable, consume compact `--json` agent plans first,
and avoid pasting verbose diffs or full remote files unless a conflict requires
targeted inspection.

## Flow

Scope resolution is deterministic:

- Current project has `Harness/scripts/wf-update-check.mjs`: update the project
  install from that script.
- A global runtime is discoverable from `Harness/.harness-version.globalDir`,
  `HARNESS_GLOBAL_HOME`, or the default `~/.harness/create-harness-vibe-coding`:
  update that runtime too, then sync its Claude/Codex/OpenCode host-global
  copies.
- Current project has no Harness install: update only the global runtime and
  host-global copies. Do not scaffold or modify the project unless the user
  explicitly asks to install Harness there.
`Harness/scripts/wf-update-runner.mjs` implements this multi-scope routing.
Older installs that do not have the runner fall back to
`Harness/scripts/wf-update-check.mjs`.

1. Run `node Harness/scripts/wf-update-runner.mjs --json` first when present;
   otherwise run `node Harness/scripts/wf-update-check.mjs --json`. Use the
   `agent` block as the action plan. Preserve `agent.releaseHighlights` for the
   user-facing update summary. Current updaters try npm
   `create-harness-vibe-coding@latest` first, then the canonical GitHub source
   `LiWeny16/create-harness-vibe-coding`, then the legacy compatibility mirror
   `zingspark/create-harness-vibe-coding`.
2. Preserve all existing PRESERVE files. Never overwrite user task, memory,
   research, root README.md, package, or architecture files. Missing scaffold
   starter files may be created, and checksum-matching legacy architecture can
   move to `Harness/project/architecture.md`. Harness/README.md is merge-tier,
   not PRESERVE.
3. If `agent.safeApplyCommand` is present, run the runner apply path to apply
   SAFE, NEW, and adopted metadata-only files across every discovered scope
   before spending AI time on conflicts. Default multi-scope command:
   `node Harness/scripts/wf-update-runner.mjs --apply-safe --json`. Single-scope
   fallback command: `node Harness/scripts/wf-update-check.mjs --apply-safe`.
   Framework-owned templates, commands, skills, agents, and scripts are
   script-owned and should be overwritten by the updater after checksum
   validation.
4. Previously accepted decisions for any merge-tier file (CLAUDE.md, AGENTS.md,
   MEMORY.md, Harness/MEMORY.md, Harness/README.md) are carried forward
   automatically when both the local hash and remote template hash are
   unchanged.
5. If a new agent/command/skill path collides with an existing file, do not
   decide by filename alone. Treat it as Harness-owned only when the file
   content has Harness/WF markers such as `harness: wf-agent`,
   `project harness`, or `Harness/...`; otherwise leave it as a real conflict.
6. For every remaining `agent.aiMergeRequired` entry, compare the local file
   with `templateHint` or `remoteUrl`, then choose merge, keep-local, or
   overwrite-from-template. Record the decision through the script with
   `--accept-local <file>`, `--accept-merged <file>`, or
   `--accept-template <file>`; do not hand-edit `Harness/.harness-version`.
   Ask the user only when the intent is ambiguous.
7. Run `node Harness/scripts/wf-update-runner.mjs --finalize --json` after all
   conflicts have script-recorded decisions. Single-scope fallback:
   `node Harness/scripts/wf-update-check.mjs --finalize`. Use strict `--apply` only when
   the JSON plan has zero conflicts.
8. After update, sync and validate all machine surfaces:
   ```
   node Harness/scripts/sync-host-global.mjs --json
   node Harness/scripts/sync-host-global.mjs --apply --json
   node Harness/scripts/validate-harness.mjs
   node Harness/scripts/validate-harness.mjs --manifest-audit
   node Harness/scripts/scan-clean.mjs --json
   ```
   `sync-host-global.mjs` is a no-op for project-only installs. For global
   installs it compares host-global files against the runtime sources listed in
   `.harness-version.hostGlobal.targets`; missing or Harness-marked stale copies
   are repaired by script, while user-looking files stay conflicts.
9. If the update reports "Already up to date" but files are missing (e.g.,
   new commands not showing up on a platform), run:
   ```
   node Harness/scripts/wf-update-runner.mjs --repair --json
   node Harness/scripts/wf-update-runner.mjs --repair --apply-safe --json
   node Harness/scripts/wf-update-runner.mjs --repair --finalize --json
   node Harness/scripts/wf-update-check.mjs --repair --json
   node Harness/scripts/wf-update-check.mjs --repair --apply-safe
   node Harness/scripts/wf-update-check.mjs --repair --finalize
   node Harness/scripts/sync-host-global.mjs --apply --json
   node Harness/scripts/validate-harness.mjs --manifest-audit
   ```
   `--repair` bypasses the version check and forces a full file diff against
   the latest remote template. This catches files that were missed during a
   previous partial update where the version was bumped but not all files
   were written.

Codex users without a direct command surface: use `$wf-update` (skill path) or
`node Harness/scripts/wf-update-check.mjs`.

## Recovery

If `Harness/scripts/wf-update-check.mjs` is missing (old install without updater), or `Harness/.harness-version` is missing or corrupted, do NOT reinstall from scratch. Recover by regenerating missing infrastructure:

```
npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip
```

The `--on-conflict skip` policy preserves all existing user files (CLAUDE.md, README.md, tasks, memory, research, architecture) and only creates missing Harness infrastructure files. After recovery, re-run the update check.

If an old updater reports only `0.8.10`, run the latest installer command above
or re-run the checker with:

```
node Harness/scripts/wf-update-check.mjs --json --source-base https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/
```

## Return

Report version, SAFE/NEW updates, conflicts and decisions, preserved files,
partialUpdate status if any, validation output, scan-clean result, and remaining
risks. Also report the core release highlights from `agent.releaseHighlights`
or `releaseNotes.highlights` so the user understands what changed in this
Harness version, not only which files changed.
