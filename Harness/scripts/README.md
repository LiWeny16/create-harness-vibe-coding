# Harness Scripts

Agents: use `task-state.mjs` for all task lifecycle operations. Other scripts are purpose-built tools invoked on demand.

## Task Lifecycle (primary)

### `task-state.mjs`

Single entry point for all task capsule operations. Use this for any task CRUD.

```bash
# Task routing and lifecycle
node Harness/scripts/task-state.mjs list [--project <project>] [--status <status>] [--json]
node Harness/scripts/task-state.mjs open [--project <project>] [--status <status>] [--json]
node Harness/scripts/task-state.mjs index
node Harness/scripts/task-state.mjs query <keyword> [--project <project>] [--status <status>] --json
node Harness/scripts/task-state.mjs validate [--strict] [--json]
node Harness/scripts/task-state.mjs reconcile [--dry-run|--apply] [--json]
node Harness/scripts/task-state.mjs set-active <task-id>  # focus an open WF task when one is managed
node Harness/scripts/task-state.mjs transition <task-id> --status <s> --phase <p>

# Task creation
node Harness/scripts/task-state.mjs record <task-id> --create --text "goal" [--status <s>] [--phase <p>] [--project <project>] [--tag <tag[,tag...]>] [--dry-run|--apply]
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
- `index` rebuilds the generated task route after task metadata changes.
- `query` performs deterministic keyword lookup across task metadata and capsule notes.
- `/wf-task-archive` calls `task-state.mjs archive`
- `/wf-task-record` calls `task-state.mjs record`
- Resume: check `task-state.mjs open` for blocked/open tasks
- Closeout: transition a task to `closed`, then run `task-state.mjs archive --apply`
- Durable WF: only tasks explicitly created with `--mode wf` or `--mode wf-max` auto-resume across sessions; mode is immutable and closed is terminal.
- Direct coexistence: direct tasks may stay open, but cannot replace an open WF focus or be promoted into WF.
- Debug: run `task-state.mjs validate --strict` to check state integrity
- Research: run `task-state.mjs history search <keyword>` to find past solutions

### Bounded context and conditional research

Workflow controllers and workers can exchange a bounded, role-scoped task pack:

```bash
node Harness/scripts/task-context.mjs pack <task-id> --project <absolutePath> --role <role> --budget-bytes <n> --json
node Harness/scripts/task-context.mjs show <task-id> --project <absolutePath> --json
```

`pack` is also the resume input; it omits entries outside the role/work item or
the byte budget. The output is a structural context boundary, not a semantic
safety guarantee. `update` is write-enabled only with `--apply`; without it the
command is a dry run and changes no task state.

Ask whether external research is warranted before using a network tool:

```bash
node Harness/scripts/research-policy.mjs decide --trigger <trigger> --task-type <type> --json
node Harness/scripts/research-policy.mjs record --project <absolutePath> --task <task-id> --input <reference.json> --apply --json
```

Use `capability-gap`, `volatile-api`, `user-request`, `repeated-failure`, or
`benchmark-gap` as triggers. A permitted search must read the actual primary
source and retain its URL, title, version, license/terms, date, and
adopt/adapt/reject rationale in task evidence.

### Runtime capability declarations

Native provider catalogs are preferred. A runtime without a native effort
catalog may use an exact operator declaration in `Harness/settings.json`:

```json
{
  "runtimeCapabilities": {
    "claude": {
      "models": {
        "gateway/claude-luna": {
          "supportedEfforts": ["low", "high", "xhigh"]
        }
      }
    }
  }
}
```

The model key and effort names are exact. `operator-configured` is provenance
only: it is not provider measurement, account entitlement, or task success.
HTTP settings updates must preserve the declaration; payloads cannot add,
replace, delete, null, or invalidate `runtimeCapabilities`. Reject invalid
capability mutations before any settings write.

### Scoped memory learning

`memory-context.mjs query` narrows existing entries before `validate`, `apply`,
or task-local `feedback`; it is not a full-memory preload. A method candidate
needs evidence, a counterexample, and passed verification, but this structural
gate does not replace semantic review.

### `archive-tasks.mjs`

Compatibility alias for `task-state.mjs archive`. Delegates all flags.

## Validation

### `validate-harness.mjs`

Validates harness structure, task state, file integrity.

```bash
node Harness/scripts/validate-harness.mjs [--strict] [--json]
```

**When to use:** pre-commit checks, CI gates, release validation. Strict mode fails on any violation.

## Project management

`project-state.mjs` manages project-level facts separately from Task execution state. Each generated project owns `Harness/project/PROJECT.json` and bounded domain records; Task status, next action, dependencies, and evidence remain in `Harness/tasks/`.

```bash
node Harness/scripts/project-state.mjs summary --root . --json
node Harness/scripts/project-state.mjs list --workspace <workspace-root> --json
node Harness/scripts/project-state.mjs section <project-id> --section risks --workspace <workspace-root> --json
node Harness/scripts/project-state.mjs import <project-id> --source <project-relative-markdown> --workspace <workspace-root> --json
```

Import defaults to a read-only preview. Apply only with the reviewed `planHash` and `--apply`; rollback also previews by default and refuses to overwrite outputs changed since import. Project archive hides the route but does not move the repository; Task archive remains the existing dated physical archive.

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
