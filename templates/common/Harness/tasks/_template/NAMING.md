# Task Naming Convention

## Format

```
<verb>-<noun>[-detail]
```

## Rules

| Rule | Example ✓ | Example ✗ |
|------|-----------|-----------|
| kebab-case (lowercase, hyphens) | `fix-ceo-inheritance` | `fix_ceo_inheritance`, `FixCeoInheritance` |
| Verb-first (describes action) | `add-goal-persistence` | `goal-persistence-add` |
| 3-5 words, ≤40 characters | `refactor-hook-role-model` | `refactor-the-entire-hook-role-model-architecture` |
| No abbreviations unless domain-standard | `fix-auth-middleware` | `fx-ath-mdw` |
| Be specific about scope | `update-claude-md-entry-contract` | `update-docs` |

## Reserved Prefixes

| Prefix | Purpose | Example |
|--------|---------|---------|
| `wf-` | Workflow system tasks | `wf-conflict-fix` |
| `auto` | Reserved for auto-mode capsule (single directory, no hyphen) | `auto` |
| `_` | Reserved for template/system directories | `_template` |

## Task ID Lifecycle

1. Created from `_template/` by copying
2. Directory name IS the task ID — used in `Harness/PROGRESS.md`, hooks, and dispatch packets
3. Directory archived (not renamed) when task completes
4. Task ID is immutable after creation (changing it breaks cross-references)

## Examples

```
add-dark-mode-support
fix-auth-token-expiry
update-harness-lifecycle-docs
remove-legacy-config-files
refactor-agent-dispatch-model
migrate-to-esm-imports
audit-security-headers
benchmark-wf-max-throughput
```
