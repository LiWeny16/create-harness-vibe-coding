# /wf-update

Run the Harness update checker script. Do not invoke a skill or start WF mode.

## Classification

MANIFEST-FIRST. The installer and updater read `Harness/ownership.manifest.json`:

- `preserve[]` - never touched (tasks, memory, research, root README, package, architecture). `Harness/tasks/**` is always preserved.
- `merge[]` - CLAUDE.md, AGENTS.md, MEMORY.md, Harness/MEMORY.md, Harness/README.md -> merge or accept-local; prior accepted decisions carry forward.
- `frameworkOwned[]` - safe overwrite-upgrade fast path (concurrent fetch + hash + all-or-nothing write after checksum validation).
- `optionalOwned[]` - upgraded only when that option is installed.

Content markers (`harness: wf-agent`, `project harness`, `Harness/...`) are the fallback when no manifest exists (old installs) and the instance-ownership signal that protects a user's same-name file at a Harness path. A same-name user file with no marker and no manifest declaration becomes conflict/skip + warning, never overwritten.

## Cache Discipline

Follow `Harness/context-loading.md#Cache-First Context Contract`: keep updater
scripts and ownership docs stable, consume compact `--json` agent plans first,
and avoid pasting verbose diffs or full remote files unless a conflict requires
targeted inspection.

## Flow

1. Run `node Harness/scripts/wf-update-check.mjs --json` first and use the
   `agent` block as the action plan. Current updaters try npm
   `create-harness-vibe-coding@latest` first, then the canonical GitHub source
   `LiWeny16/create-harness-vibe-coding`, then the legacy compatibility mirror
   `zingspark/create-harness-vibe-coding`.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research,
   root README.md, package, or architecture files. Harness/README.md is
   merge-tier, not PRESERVE.
3. If `agent.safeApplyCommand` is present, run it to apply SAFE, NEW, and
   adopted metadata-only files before spending AI time on conflicts. Default
   command: `node Harness/scripts/wf-update-check.mjs --apply-safe`.
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
7. Run `node Harness/scripts/wf-update-check.mjs --finalize` after all
   conflicts have script-recorded decisions. Use strict `--apply` only when the
   JSON plan has zero conflicts.
8. After update, run `node Harness/scripts/validate-harness.mjs` and then
   `node Harness/scripts/scan-clean.mjs`.

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
partialUpdate status if any, validation output, scan-clean result, and
remaining risks.
