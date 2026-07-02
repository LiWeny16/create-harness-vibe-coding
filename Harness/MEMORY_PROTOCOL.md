# Memory Protocol

Purpose: record durable lessons from acceptance, validation, and debug work without storing noisy or sensitive context.

Memory is downstream of evidence. It records reusable patterns, not raw transcripts.

## When To Write Memory

Write memory when any condition applies:

- the same tool or command pattern fails 3+ times
- the user corrects the same assumption or preference 2+ times
- a review/debug loop reveals a reusable lesson
- WF closeout extracts durable acceptance, validation, or debug knowledge

## What To Record

Memory entries should be short, newest-first, and AC-aware when possible:

```markdown
## 2026-07-02 - Playwright login validation needs network trace

- Context: AC-003 passed visually but failed API payload validation.
- Lesson: For login flows, require CDP/Playwright request assertions in addition to DOM checks.
- Applies to: `ACCEPTANCE_PROTOCOL.md`, `HARNESS_BRIDGE.md`
```

Good memory:

- failure mode
- root cause pattern
- better command or protocol
- affected AC IDs or workflow docs
- proof that the lesson is durable

Bad memory:

- secrets, tokens, credentials, private user data
- full logs when a summary is enough
- transient speculation
- implementation summaries with no reusable lesson

## Closeout Flow

For WF closeout:

```text
context-master
-> extract durable acceptance/debug/validation lessons
-> memory-master
-> deduplicate
-> write concise memory entry
```

Memory Master writes to:

- `Harness/memory/tool-usage-reflections.md`
- `Harness/memory/user-corrections-preferences.md`
- `Harness/memory/agent-lessons-patterns.md`
- `Harness/MEMORY.md` only for routing/index updates

## Scenario Memory Hints

Controllers, context-master, or memory-master may load a compact memory hint
when the current task matches a known scenario. Hints must be scenario-specific
and must not dump full memory files into context.

Scenario hints are allowed when they help the current task avoid a known failure
mode:

| Scenario | Load Or Hint |
| --- | --- |
| new session / startup | `Harness/MEMORY.md` index only |
| same tool or command error repeats | matching entries from `memory/tool-usage-reflections.md` |
| user repeats a correction or preference | matching entries from `memory/user-corrections-preferences.md` |
| review/debug/validation failure | matching entries from `memory/agent-lessons-patterns.md` |
| acceptance/UI/API work | relevant AC/debug lessons plus `ACCEPTANCE_PROTOCOL.md` and `HARNESS_BRIDGE.md` |
| WF closeout | context-master extraction, then memory-master write/dedup |
| `/wf-auto` cycle start | auto PROGRESS/PLAN summary plus memory hints tied to the selected angle |

Hint rules:

- load or summarize 3-10 bullets, not whole memory files
- include file paths and trigger reasons
- include AC IDs or failure signatures when available
- load nothing when no relevant memory exists
- never inject secrets, credentials, tokens, private data, or raw transcripts
- memory-master owns writes; controller/context-master route context

## Memory Write Flow

Memory write triggers must never append raw logs directly to memory files.

Safe write flow:

```text
controller detects trigger
-> context-master extracts durable candidate
-> memory-master reads existing memory
-> memory-master deduplicates or merges
-> memory-master writes concise entry
-> controller records file path and reason
```

## Traceability

When a lesson comes from acceptance work, include:

- AC ID or contract name
- command or validation method
- failure layer
- final fix or operating rule

This keeps future agents from relearning the same acceptance gap.
