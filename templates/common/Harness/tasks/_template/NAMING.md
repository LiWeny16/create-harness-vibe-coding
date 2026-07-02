# Task Naming Convention

## Format

```
task-<verb>-<noun>[-detail]
```

All task directories MUST have the `task-` prefix. This distinguishes tasks from system directories at a glance.

## Rules

| Rule | Example ✓ | Example ✗ |
|------|-----------|-----------|
| `task-` prefix required | `task-fix-ceo-inheritance` | `fix-ceo-inheritance` |
| kebab-case (lowercase, hyphens) | `task-fix-ceo-inheritance` | `task-fix_ceo_inheritance` |
| Verb-first after prefix | `task-add-goal-persistence` | `task-goal-persistence-add` |
| 2-5 words after prefix, <=46 total chars | `task-refactor-role-contract` | `task-refactor-the-entire-role-contract-model` |
| No abbreviations unless domain-standard | `task-fix-auth-middleware` | `task-fx-ath-mdw` |

## Reserved Names

| Name | Purpose |
|------|---------|
| `_template` | Task capsule template (never a real task) |
| `auto` | Auto-mode capsule (shared by `/wf-auto` and `/wf-auto-spark`) |

## Task ID Lifecycle

1. Created by copying `_template/` → `task-<verb>-<noun>/`
2. Directory name IS the task ID - used in `Harness/PROGRESS.md` and dispatch packets
3. Directory archived (not renamed) when task completes
4. Task ID is immutable after creation (changing it breaks cross-references)
5. Existing tasks without `task-` prefix are grandfathered — rename is optional but recommended

## Examples

```
task-add-dark-mode-support
task-fix-auth-token-expiry
task-update-harness-lifecycle-docs
task-remove-legacy-config-files
task-refactor-agent-dispatch-model
task-migrate-to-esm-imports
task-audit-security-headers
task-benchmark-wf-max-throughput
```
