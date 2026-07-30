# Harness Scripts

Agents: use `task-state.mjs` for all task lifecycle operations. Other scripts are purpose-built tools invoked on demand.

## Task Lifecycle (primary)

### `task-state.mjs`

Single entry point for all task capsule operations. Use this for any task CRUD.

```bash
# Active tasks
node Harness/scripts/task-state.mjs list [--json]
node Harness/scripts/task-state.mjs open [--json]
node Harness/scripts/task-state.mjs validate [--strict] [--json]
node Harness/scripts/task-state.mjs reconcile [--dry-run|--apply] [--json]
node Harness/scripts/task-state.mjs set-active <task-id>
node Harness/scripts/task-state.mjs transition <task-id> --status <s> --phase <p>

# Task creation
node Harness/scripts/task-state.mjs record <task-id> --create --text "goal" [--status <s>] [--dry-run|--apply]
node Harness/scripts/task-state.mjs record --title "title" --note "note"  # auto-generates ID

# Archive (moves completed tasks to _archive/YYYY/MM/DD/)
node Harness/scripts/task-state.mjs archive [--dry-run|--apply] [--keep n] [--task id] [--json]

# History (archived task management)
node Harness/scripts/task-state.mjs history list [--year YYYY] [--month MM] [--json]
node Harness/scripts/task-state.mjs history search <keyword> [--json]
node Harness/scripts/task-state.mjs history load <task-id> [--json]
node Harness/scripts/task-state.mjs history delete <task-id> [--dry-run|--apply] [--json]
```

**When to use:**
- `/wf-task-list` calls `task-state.mjs list`
- `/wf-task-archive` calls `task-state.mjs archive`
- `/wf-task-record` calls `task-state.mjs record`
- Resume: check `task-state.mjs open` for blocked/open tasks
- Closeout: run `task-state.mjs archive --apply` to clean up verified tasks
- Debug: run `task-state.mjs validate --strict` to check state integrity
- Research: run `task-state.mjs history search <keyword>` to find past solutions

### `archive-tasks.mjs`

Compatibility alias for `task-state.mjs archive`. Delegates all flags.

## Validation

### `validate-harness.mjs`

Validates harness structure, task state, file integrity.

```bash
node Harness/scripts/validate-harness.mjs [--strict] [--json]
```

**When to use:** pre-commit checks, CI gates, release validation. Strict mode fails on any violation.

## Maintenance

### `wf-remove.mjs`

Safely removes the Harness scaffold from a project.

```bash
node Harness/scripts/wf-remove.mjs [--dry-run|--apply] [--json]
```

**When to use:** uninstalling Harness, cleaning up test installs. Always dry-run first.

### `wf-update-check.mjs`

Checks if a newer Harness version is available.

```bash
node Harness/scripts/wf-update-check.mjs [--json]
```

**When to use:** `/wf-update` command, periodic drift detection.

### `wf-auto-update-prompt.mjs`

Generates context-aware update prompts for WF-AUTO cycles.

```bash
node Harness/scripts/wf-auto-update-prompt.mjs
```

**When to use:** internally by WF-AUTO/WF-AUTO-SPARK cycles. Not invoked directly.

### `scan-clean.mjs`

Scans and cleans stale artifacts, temp files, orphaned references.

```bash
node Harness/scripts/scan-clean.mjs [--dry-run|--apply] [--json]
```

**When to use:** before releases, after large refactors, periodic housekeeping.

## Telemetry

### `l2-cache-telemetry.mjs`

Measures prompt-cache hit rates across CLI runtimes (Claude Code, Codex, OpenCode).

```bash
node Harness/scripts/l2-cache-telemetry.mjs --groups <g1>,<g2> --turns <n> [--json]
```

**When to use:** benchmarking cache performance, tuning context loading, regression detection.

### `context-budget.mjs`

Estimates context budget usage for a given task or workflow tier.

```bash
node Harness/scripts/context-budget.mjs [--tier wf-light|wf-standard|wf-full|wf-max]
```

**When to use:** before large workflows, capacity planning, timeout risk assessment.

## Agent Quick Reference

| Goal | Command |
|------|---------|
| List active tasks + graph | `node Harness/scripts/task-state.mjs list` |
| Find blocked tasks | `node Harness/scripts/task-state.mjs open --json` |
| Create new task | `node Harness/scripts/task-state.mjs record --title "..." --note "..." --apply` |
| Archive completed tasks | `node Harness/scripts/task-state.mjs archive --apply` |
| Search history for "timeout" | `node Harness/scripts/task-state.mjs history search timeout --json` |
| Load old task full record | `node Harness/scripts/task-state.mjs history load <task-id> --json` |
| Validate state integrity | `node Harness/scripts/validate-harness.mjs --strict` |
| Pre-release cleanup | `node Harness/scripts/scan-clean.mjs --dry-run` |
