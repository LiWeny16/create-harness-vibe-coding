---
name: wf-learn
description: Use for /wf-learn or when the user wants to force a learning cycle from repeated errors, patterns, or session history. Dispatches context-master → memory-master pipeline to extract and consolidate durable knowledge.
---

# WF Learn

Force a memory learning cycle. Context-master analyzes, memory-master consolidates. Writes to project-level `Harness/memory/*` and cross-project global memory.

## Load

- `Harness/MEMORY.md`
- `Harness/memory/tool-usage-reflections.md`
- `Harness/memory/user-corrections-preferences.md`
- `Harness/memory/agent-lessons-patterns.md`
- Current `Harness/PROGRESS.md` for active task context

## Flow

```text
1. context-master: analyze session, extract patterns
2. memory-master: categorize + deduplicate + write to memory files
3. CEO: commit memory files
```

## Write Targets

| Scope | Path | When |
|---|---|---|
| Project | `Harness/memory/tool-usage-reflections.md` | tool/command patterns found |
| Project | `Harness/memory/user-corrections-preferences.md` | user preferences found |
| Project | `Harness/memory/agent-lessons-patterns.md` | review/debug lessons found |
| Global | `<user>/.claude/projects/*/memory/` | cross-project patterns |

## Rules

- Never auto-write without context-master analysis first.
- Memory-master handles dedup — if existing entry covers the same ground, update instead of creating duplicate.
- If no new patterns found, report "nothing to learn" — don't force empty writes.
- Subagents are readers and reporters. CEO writes the final memory files.

## Return

- Files written or updated
- Patterns extracted (one-line each)
- Skipped (with reason)
