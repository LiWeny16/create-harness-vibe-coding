# Task Naming Convention

## Format

```
task-<verb>-<noun>[-detail]-<MMDD>
```

All task directories MUST have the `task-` prefix and end with a 4-digit month-day suffix (MMDD, e.g. `0729` for July 29). This distinguishes tasks from system directories and provides chronological ordering.

## Rules

| Rule | Example ✓ | Example ✗ |
|------|-----------|-----------|
| `task-` prefix + MMDD suffix required | `task-fix-ceo-inheritance-0730` | `fix-ceo-inheritance-0730` |
| kebab-case (lowercase, hyphens) | `task-fix-ceo-inheritance-0730` | `task-fix_ceo_inheritance-0730` |
| Verb-first after prefix | `task-add-goal-persistence-0730` | `task-goal-persistence-add-0730` |
| 2-5 words after prefix + MMDD date, <=46 total chars | `task-refactor-role-contract-0729` | `task-refactor-the-entire-role-contract-model-0729` |
| No abbreviations unless domain-standard | `task-fix-auth-middleware-0730` | `task-fx-ath-mdw-0730` |

## Reserved Names

| Name | Purpose |
|------|---------|
| `_template` | Task capsule template (never a real task) |
| `auto` | Auto-mode capsule (shared by `/wf-auto` and `/wf-auto-spark`) |

## Task ID Lifecycle

1. Created by copying `_template/` → `task-<verb>-<noun>-<MMDD>/`
2. Directory name IS the task ID - used in `Harness/PROGRESS.md` and dispatch packets
3. Directory archived (not renamed) when task completes
4. Task ID is immutable after creation (changing it breaks cross-references)
5. Existing tasks without `task-` prefix are grandfathered — rename is optional but recommended

## Examples

```
task-add-dark-mode-support-0729
task-fix-auth-token-expiry-0730
task-update-harness-lifecycle-docs-0728
task-remove-legacy-config-files-0731
task-refactor-agent-dispatch-model-0801
task-migrate-to-esm-imports-0802
task-audit-security-headers-0803
task-benchmark-wf-max-throughput-0804
```
