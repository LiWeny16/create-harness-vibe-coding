# /wf-task-record

Record a task into a Harness task capsule. Do not invoke a skill or start WF mode.

## Classification

DIRECT command. Wraps `node Harness/scripts/task-state.mjs record`. Never loads Harness/MEMORY.md.

## Usage

/wf-task-record [<task-id>] [--title <slug>] [--note <text>] [--context <text>] [--new] [--create] [--status <status>] [--mode <mode>] [--text "description"]

- With <task-id>: record to that task (existing semantics).
- Without <task-id>: --title/--note/--context required. Deterministically matches open tasks; updates if unique match found; creates new if no match; fails if ambiguous unless --new.
- Never uses LLM or embeddings — slug + keyword overlap only.

## Execution

Run: `node Harness/scripts/task-state.mjs record [<task-id>] [--title <slug>] [--note <text>] [--context <text>] [--new] [--create] [--apply] [--text "..."] [--status <status>] [--mode <mode>] [--json]`

## Return

- Output of `node Harness/scripts/task-state.mjs record ... --json`
- If the command fails, report the error and do not retry.
