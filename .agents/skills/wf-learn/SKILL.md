---
name: wf-learn
description: Use for /wf-learn in Claude Code, $wf-learn or /skills wf-learn in Codex, or when the user wants a learning cycle from repeated errors, corrections, patterns, or session history.
---

# WF Learn Adapter

Force a memory learning cycle. Context-master analyzes; memory-master
consolidates. Use the active runtime's available subagent mechanism when
present, otherwise emulate the same roles as bounded passes and record that
fallback.

**Note:** Explicit user preferences (remember/next time/never/always/记住/下次/不要再) can be written immediately via candidate detection without waiting for `/wf-learn`. `/wf-learn` is for proactive pattern consolidation and closeout extraction.

## Load

- `Harness/MEMORY.md`
- `Harness/memory/routes.md`
- `Harness/memory/startup-hints.md`
- `Harness/memory/tool-usage-reflections.md`
- `Harness/memory/user-corrections-preferences.md`
- `Harness/memory/agent-lessons-patterns.md`
- Current `Harness/PROGRESS.md` and active task capsule, if any

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: load memory
indexes first, then only the routed detailed memory files; summarize durable
patterns by file path and signal instead of pasting session transcripts.

## Flow

1. Analyze the session for repeated failures, durable user corrections, and
   reusable review/debug lessons.
2. Check `Harness/memory/routes.md` for existing entries before writing.
3. Deduplicate against existing memory.
4. Write only concise, durable, non-secret lessons to `Harness/memory/*`.
   Use compact format (default no date):
   `- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.`

## Return

Report files updated, patterns extracted, skipped candidates, and why each
memory entry should survive context loss.
