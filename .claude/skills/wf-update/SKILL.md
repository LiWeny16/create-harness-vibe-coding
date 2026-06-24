---
name: wf-update
description: Use when the user says /wf update, wf update, update harness, or check for updates. Fetches latest template files from GitHub, compares against stored checksums, and applies incremental updates safely.
---

# WF Update

GitHub-based incremental harness update. Pulls latest template files and compares against stored checksums in `Harness/.harness-version`.

## Load

- `Harness/.harness-version`
- `Harness/README.md#Update Mechanism` row (when available)

## How It Works

1. Read `Harness/.harness-version` -- get current `generator` version and stored `checksums`.
2. Fetch the latest template file list from GitHub:
   - Base URL: `https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/templates/common/`
   - Fetch `.harness-version` from the repo first to get the latest version and expected file list.
   - If the repo version equals the local version, report "Already up to date."
3. For each file in the repo's checksums map:
   - Compute SHA-256 of the fetched file content (normalize line endings to LF).
   - Compare against the local stored checksum in `Harness/.harness-version`.
4. Classify each difference:
   - **SAFE** (TIER 1): Harness runtime files. If local checksum matches stored -> file is unmodified -> safe to overwrite with fetched version.
   - **PRESERVE** (TIER 2): User data files. Never overwrite. (`Harness/PROGRESS.md`, `Harness/tasks/**`, `Harness/memory/**`, `Harness/research/PRD.md`, `Harness/research/research-results.md`, `Harness/architecture.md`, `Harness/domain/ports.md`, `Harness/features/**`, root `README.md`, `.gitignore`)
   - **MERGE** (TIER 3): Dual-purpose files. If local checksum matches stored -> safe to overwrite. If mismatch -> user modified -> report as merge candidate, never auto-overwrite. (`CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`)
5. For files in the GitHub repo NOT in local checksums: classify as NEW, plan to create.
6. Report update plan: `updated/N, merge/N, created/N, skipped/N`
7. If `--check` flag: report only, do not write.
8. Apply updates:
   - SAFE files: overwrite with fetched content.
   - NEW files: create.
   - MERGE files with matching checksums: overwrite.
   - MERGE files with mismatched checksums: skip, warn user.
   - PRESERVE files: never touched.
9. Update `Harness/.harness-version`:
   - Update `generator` to latest version.
   - Update `generated` timestamp.
   - Recompute and store checksums for all updated files.
10. Record update in `Harness/tasks/harness-update/PROGRESS.md` (create task capsule if needed).

## Rules

- Never overwrite PRESERVE files.
- Never auto-overwrite MERGE files with mismatched checksums.
- If offline (cannot reach GitHub), report and exit cleanly.
- After update, suggest running `node Harness/scripts/validate-harness.mjs`.
- Subagents are readers and reporters. Only the main agent writes updated files.

## Return

- Update plan summary
- Files updated
- Files skipped (with reasons)
- New version
- Validation suggestion
