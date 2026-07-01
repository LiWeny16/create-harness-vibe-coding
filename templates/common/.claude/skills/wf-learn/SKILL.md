---
name: wf-learn
description: Use for /wf-learn in Claude Code, $wf-learn or /skills wf-learn in Codex, or when the user wants a learning cycle from repeated errors, corrections, patterns, or session history.
---

# WF Learn Adapter

Force a memory learning cycle. Context-master analyzes; memory-master
consolidates. Use the active runtime's available subagent mechanism when
present, otherwise emulate the same roles as bounded passes and record that
fallback.

## Load

- `Harness/MEMORY.md`
- `Harness/memory/tool-usage-reflections.md`
- `Harness/memory/user-corrections-preferences.md`
- `Harness/memory/agent-lessons-patterns.md`
- Current `Harness/PROGRESS.md` and active task capsule, if any

## Flow

1. Analyze the session for repeated failures, durable user corrections, and
   reusable review/debug lessons.
2. Deduplicate against existing memory.
3. Write only concise, durable, non-secret lessons to `Harness/memory/*`.

## Return

Report files updated, patterns extracted, skipped candidates, and why each
memory entry should survive context loss.
