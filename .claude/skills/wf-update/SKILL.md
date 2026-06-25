---
name: wf-update
description: Use when the user says /wf-update, wf update, update harness, or check for updates. Script-driven comparison for speed — fetches remote checksums, compares locally in milliseconds, only surfaces conflicts for user decision.
---

# WF Update

Script-driven harness update. The script does all comparison in milliseconds; AI only handles CONFLICT files.

## Load

- `Harness/scripts/wf-update-check.mjs` — the fast comparison + apply script
- `Harness/.harness-version` — stored checksums

## How It Works (script-driven, fast)

1. Run `node Harness/scripts/wf-update-check.mjs` — fetches remote `.harness-version`, compares all checksums locally, outputs instant plan.
2. The script classifies every file:

| Tier | Meaning | Action |
|------|---------|--------|
| **SAFE** | Framework file, local matches stored checksum | Auto-update |
| **NEW** | File in remote but not local | Auto-create |
| **CONFLICT** | MERGE file user modified, or runtime file diverged | **User decides** |
| **PRESERVE** | User data (PROGRESS, tasks, memory, PRD, README, etc.) | **Never touch** |
| **SKIPPED** | File in local but not remote | Skip |

3. For CONFLICT files, present each one to the user:
   - Show file path and reason
   - Options: **[M]erge** (recommended — keep user changes, apply framework updates) / **[O]verwrite** (discard user changes, use remote) / **[K]eep** (skip this file)

4. Run `node Harness/scripts/wf-update-check.mjs --apply` to execute SAFE+NEW files. CONFLICT files are resolved manually by the AI after user decision.
5. After update, run `node Harness/scripts/validate-harness.mjs`.

## Speed

| Step | Before (AI-driven) | After (script-driven) |
|------|-------------------|----------------------|
| Fetch file list | N WebFetch calls | 1 HTTP fetch |
| Compare checksums | AI reads each file | Script computes SHA-256 in ms |
| Classify | AI reasons per file | Script uses pattern matching |
| Apply | AI writes each file | Script batch writes |

## Rules

- **NEVER overwrite PRESERVE files.** No exceptions.
- **NEVER auto-merge CONFLICT files** — user MUST decide: merge / overwrite / keep.
- If offline: report and exit cleanly.
- After update, suggest `node Harness/scripts/validate-harness.mjs`.
- The script normalizes line endings (CRLF→LF) for checksum comparison.

## Return

- Update version (from → to)
- Files auto-updated (SAFE + NEW count)
- Files in conflict (each with merge/overwrite/keep decision)
- Files skipped
- Validation suggestion
