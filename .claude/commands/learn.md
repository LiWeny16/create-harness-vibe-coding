# /wf-learn

Force a memory learning cycle. Dispatches `context-master` to analyze the session, then `memory-master` to consolidate extracted knowledge into `Harness/memory/*` (project-level) and cross-project global memory.

## Required

- Load `wf-learn` skill.
- MUST dispatch `context-master` first, then `memory-master`.
- Both agents are read-only reporters; CEO writes the final memory files.

## Flow

```text
context-master (analyze)
→ memory-master (consolidate)
→ CEO writes to Harness/memory/* + global memory
```
