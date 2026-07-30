---
name: wf-update
description: Codex compatibility: use $wf-update or /skills wf-update in Codex. In Claude Code and OpenCode, /wf-update is a direct command (see .claude/commands/wf-update.md and .opencode/commands/wf-update.md).
---

# WF Update Adapter

This skill is a Codex compatibility shim plus script-flow reference. Claude Code and OpenCode handle `/wf-update` as a direct command; do not route them through this skill.

## Invocation

- Codex CLI or IDE: use `$wf-update` or `/skills` then choose `wf-update`.
- Claude Code: `/wf-update` is a direct command. Use `.claude/commands/wf-update.md`, not this skill.
- OpenCode: `/wf-update` is a direct command. Use `.opencode/commands/wf-update.md`, not this skill.

## Load

- `Harness/.harness-version`
- `Harness/ownership.manifest.json`
- `Harness/scripts/wf-update-check.mjs`
- `Harness/scripts/wf-update-runner.mjs`
- `Harness/scripts/sync-host-global.mjs`
- `Harness/scripts/scan-clean.mjs`
- `Harness/scripts/validate-harness.mjs`

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: keep updater scripts and ownership docs stable, consume compact `--json` agent plans first, and avoid pasting verbose diffs or full remote files unless a conflict requires targeted inspection.

## Classification

MANIFEST-FIRST. The installer and updater read `Harness/ownership.manifest.json`:

- `preserve[]` - never touched when present as user data: tasks, memory, research, root README, package, architecture, and progress. `Harness/tasks/**` is always preserved.
- `merge[]` - CLAUDE.md, AGENTS.md, MEMORY.md, Harness/MEMORY.md, Harness/README.md, and Harness/settings.json require merge or accept-local; prior accepted decisions carry forward.
- `frameworkOwned[]` - safe overwrite-upgrade fast path after checksum validation. This must cover `.claude`, `.codex`, `.agents`, `.opencode`, and Harness template-owned scripts/specs.
- `optionalOwned[]` - upgraded only when that option is installed.

Content markers (`harness: wf-agent`, `project harness`, `Harness/...`) are the fallback when no manifest exists and the instance-ownership signal that protects a user's same-name file at a Harness path. A same-name user file with no marker and no manifest declaration becomes conflict/skip plus warning, never overwrite.

## Flow

Scope resolution is deterministic:

- Current project has `Harness/scripts/wf-update-check.mjs`: update the project install from that script.
- A global runtime is discoverable from `Harness/.harness-version.globalDir`, `HARNESS_GLOBAL_HOME`, or the default `~/.harness/create-harness-vibe-coding`: update that runtime too, then sync its Claude/Codex/OpenCode host-global copies.
- Current project has no Harness install: update only the global runtime and host-global copies. Do not scaffold or modify the project unless the user explicitly asks to install Harness there.
`Harness/scripts/wf-update-runner.mjs` implements this multi-scope routing. Older installs that do not have the runner fall back to `Harness/scripts/wf-update-check.mjs`.

1. Run `node Harness/scripts/wf-update-runner.mjs --json` first when present; otherwise run `node Harness/scripts/wf-update-check.mjs --json` and use the `agent` block as the action plan. Current updaters try npm `create-harness-vibe-coding@latest` first, then canonical GitHub `LiWeny16/create-harness-vibe-coding`, then legacy mirror `zingspark/create-harness-vibe-coding`.
2. Preserve all PRESERVE files. Never overwrite user task, memory, research, root README.md, package, progress, or architecture files. Harness/README.md is merge-tier, not PRESERVE.
3. If `agent.safeApplyCommand` is present, run the runner apply path to apply SAFE, NEW, moved, and adopted metadata-only files across every discovered scope before spending AI time on conflicts. Default multi-scope command: `node Harness/scripts/wf-update-runner.mjs --apply-safe --json`. Single-scope fallback command: `node Harness/scripts/wf-update-check.mjs --apply-safe`.
4. Previously accepted decisions for merge-tier files are carried forward automatically when both the local hash and remote template hash are unchanged.
5. If a new agent/command/skill path collides with an existing file, do not decide by filename alone. Treat it as Harness-owned only when the file content has Harness/WF markers such as `harness: wf-agent`, `project harness`, or `Harness/...`; otherwise leave it as a real conflict.
6. For every remaining `agent.aiMergeRequired` entry, compare the local file with `templateHint` or `remoteUrl`, then choose merge, keep-local, or overwrite-from-template. Record the decision through the script with `--accept-local <file>`, `--accept-merged <file>`, or `--accept-template <file>`; do not hand-edit `Harness/.harness-version`.
7. Run `node Harness/scripts/wf-update-runner.mjs --finalize --json` after all conflicts have script-recorded decisions. Single-scope fallback: `node Harness/scripts/wf-update-check.mjs --finalize`. Use strict `--apply` only when the JSON plan has zero conflicts.
8. After apply/finalize, run all post-update checks:

```bash
node Harness/scripts/sync-host-global.mjs --json
node Harness/scripts/sync-host-global.mjs --apply --json
node Harness/scripts/validate-harness.mjs
node Harness/scripts/validate-harness.mjs --manifest-audit
node Harness/scripts/scan-clean.mjs --json
```

9. If the update reports "Already up to date" but framework files are missing or stale, run repair mode:

```bash
node Harness/scripts/wf-update-runner.mjs --repair --json
node Harness/scripts/wf-update-runner.mjs --repair --apply-safe --json
node Harness/scripts/wf-update-runner.mjs --repair --finalize --json
node Harness/scripts/wf-update-check.mjs --repair --json
node Harness/scripts/wf-update-check.mjs --repair --apply-safe
node Harness/scripts/wf-update-check.mjs --repair --finalize
node Harness/scripts/sync-host-global.mjs --apply --json
node Harness/scripts/validate-harness.mjs --manifest-audit
```

`--repair` bypasses the version check and forces a full file diff against the latest remote template. This catches partial updates where the version advanced but files such as `/wf-task-list`, `/wf-help`, Codex `.agents` skill mirrors, OpenCode commands, `.codex` config, or Harness scripts were not written.
`sync-host-global.mjs` is a no-op for project-only installs. For global installs it repairs missing or Harness-marked stale host-global copies by script and reports user-looking files as conflicts.

## Recovery

If `Harness/scripts/wf-update-check.mjs` is missing, or `Harness/.harness-version` is missing or corrupted, do not reinstall from scratch. Recover by regenerating missing infrastructure:

```bash
npx create-harness-vibe-coding@latest <project-name> . -y --on-conflict skip
```

The `--on-conflict skip` policy preserves all existing user files and only creates missing Harness infrastructure files. After recovery, run the update check and manifest audit.

If an old updater reports only `0.8.10`, run the latest installer command above or re-run the checker with:

```bash
node Harness/scripts/wf-update-check.mjs --json --source-base https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/
```

## Return

Report version, SAFE/NEW updates, conflicts and decisions, preserved files, partialUpdate status if any, validation output, manifest-audit output, scan-clean result, and remaining risks. Also report the core release highlights from `agent.releaseHighlights` or `releaseNotes.highlights`.
