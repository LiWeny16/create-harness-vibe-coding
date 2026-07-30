---
description: List Harness task capsules with state, phase, status, and dependency info
---
# /wf-task-list

List Harness task capsules with state, phase, status, and dependency info. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. Wraps `node Harness/scripts/task-state.mjs list --json`. Never loads Harness/MEMORY.md.

## Usage

/wf-task-list [--json]

- By default, returns a human-readable listing of all task capsules.
- With --json, returns structured JSON output.
- Shows active, open, blocked, verified tasks with dependency info.

## Execution

Run: `node Harness/scripts/task-state.mjs list --json`

## Return

- JSON output of all task capsules with status, phase, dependencies, and archive eligibility.
- Includes a `graph` section: roots, dependency edges, block edges, and orphaned dependency warnings.
- Human-readable mode renders the graph with ASCII arrows: `from ──▶ to` (depends) and `from ▸▸ to` (blocks).
- If the command fails, report the error and do not retry.
