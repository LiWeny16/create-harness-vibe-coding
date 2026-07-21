# wf-update-mechanism — PLAN

## Goal

1. Fix ALL PLAN.md stale references (CRITICAL + HIGH from lifecycle test)
2. Implement `/wf update` — GitHub-based incremental harness update

## How `/wf update` Works

1. User types `/wf update` or `/wf update --check`
2. Agent reads `Harness/.harness-version` to get current version + stored checksums
3. Fetches latest template files from `https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/`
4. Computes SHA-256 checksums of fetched files
5. Compares against stored checksums:
   - Match → file unchanged, skip
   - Mismatch + stored checksum matches local file → file unmodified by user, SAFE to update
   - Mismatch + stored checksum differs from local → user-modified, CONFLICT
   - New file in GitHub not in checksums → NEW, create
6. Reports plan: updated/N, merge/N, created/N, skipped/N
7. Applies updates (with `--on-conflict` policy)
8. Updates `.harness-version` with new checksums + version

## Key Design Decisions

- **GitHub raw URLs, not npm**: No CLI changes needed. Agent-driven, works offline with cached data.
- **Checksum-based safety**: Same 3-tier file classification (SAFE/PRESERVE/MERGE) from DESIGN.md.
- **No network dependency for basic use**: Only `/wf update` needs network. Normal workflow works offline.

## Scope

Allowed: .claude/skills/wf-update/, .claude/commands/update.md, templates/common/.harness-version, CLAUDE.md, Harness/README.md, MEMORY.md, validate-harness.mjs, 16 files with stale PLAN.md refs

Forbidden: src/generator.js (no CLI changes needed), package.json
