---
name: wf-remove
description: Safely remove Harness framework files. Auto-removes unmodified files, requires user confirmation for anything modified or uncertain. Use for /wf-remove, wf remove, remove harness, or uninstall harness.
---

# WF Remove

Safely removes Harness framework files from a project. Classification is script-driven for speed — no AI guessing about what's safe to delete.

## Load

- `Harness/scripts/wf-remove.mjs` — the removal script
- `Harness/.harness-version` — stored checksums for modification detection

## How It Works

1. Run `node Harness/scripts/wf-remove.mjs` first — this outputs a DRY-RUN plan instantly.
2. The script classifies all files into three tiers:

| Tier | Meaning | Action |
|------|---------|--------|
| **SAFE** | Framework file matching stored checksum (unmodified) | Auto-remove |
| **MODIFIED** | Framework file edited by user, or not in checksums | **MUST confirm with user** |
| **USER DATA** | User-owned files (PROGRESS, tasks, memory, research, README, etc.) | **NEVER remove** |

3. Review the plan. For MODIFIED files, present each one to the user:
   - Show file path and reason it's flagged
   - Options: **[D]elete** / **[K]eep** (default: keep)
   - Never delete without explicit user confirmation

4. Run `node Harness/scripts/wf-remove.mjs --apply` to execute.
5. After removal, empty directories are auto-cleaned up.
6. The CLAUDE.md Harness Binding section is flagged for separate confirmation.

## Rules

- **NEVER delete USER DATA files.** No exceptions.
- **NEVER delete MODIFIED files without user confirmation.** Each file must be explicitly approved.
- **DO auto-remove SAFE files** — these match the original scaffold checksum, user never touched them.
- After removal, suggest `git status` to review.
- If `.claude/settings.json` was modified (user added hooks/permissions), flag it separately — the user may want to keep their hooks.
- Do NOT auto-delete Harness/ if it still contains user files.

## Return

- Files removed (safe)
- Files kept (modified, user chose keep)
- Files preserved (user data — never touched)
- Directories cleaned up
- CLAUDE.md status
- Git status suggestion
