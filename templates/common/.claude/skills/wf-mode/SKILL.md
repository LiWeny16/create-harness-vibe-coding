---
name: wf-mode
description: Use for /wf, wf mode, workflow mode, wk mode, long difficult tasks, multi-file or multi-agent work, low-confidence decisions, repeated failures, migrations, architecture-heavy changes, browser-visible work, or any task that needs exploration -> second plan -> implementation -> review -> verification -> recovery.
---

# WF Mode

Load:

- `Harness/WF.md`
- `Harness/PROGRESS.md`
- `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` when active
- `Harness/agent-workflow.md` when implementation, review, or verification starts
- `Harness/subagents.md`, `Harness/dispatch.md`, and `Harness/context-loading.md` immediately for explicit WF/WK mode; otherwise only when coordinating subagents or bounded role passes
- current feature doc when one exists
- `Harness/workflows/browser-e2e.md` when browser-visible behavior is affected and the workflow is installed

Follow:

```text
intake + 95% confidence gate
-> parallel read-only exploration
-> synthesis and second plan
-> failing test or manual check
-> bounded implementation
-> review
-> verification
-> debugger recovery loop when verification fails (dispatch context-master then memory-master, or use /wf-learn)
-> context-master session analysis + knowledge extraction
-> memory-master consolidation
-> close with evidence
```

Rules:

- Update `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat` before long commands, after failures, before handoff, and at closeout.
- Explicit `/wf`, `wf mode`, `workflow mode`, or `wk mode` MUST use `subagent-orchestrator` and spawn at least 3 distinct subagents from `.claude/agents/` before second planning.
- Use the 7:3 collaboration bias from `Harness/WF.md`: default to multi-agent collaboration for substantial work; use solo mode only for clearly small/local tasks outside explicit WF/WK mode.
- Use `subagent-orchestrator` and `Harness/subagents.md` when the task has broad reading, cross-layer impact, independent review needs, or repeated failures.
- Subagents return findings and PLAN patch suggestions. Only the main agent writes to task PROGRESS.md and PLAN.md.
- If subagents are unavailable, emulate the same roles as separate bounded passes.
- Do not claim browser/UI acceptance without real-browser evidence from Chrome DevTools, CDP, Playwright, or documented manual browser checks.
- If `Harness/workflows/browser-e2e.md` is not installed, use `Harness/WF.md#Browser And API Evidence` as the fallback evidence contract or ask the user before adding the optional workflow.
- Before closeout, dispatch `context-master` then `memory-master` (or use `/wf-learn`) to extract and consolidate lessons. Do not skip — the auto-trigger is unreliable; make this a mandatory gate.

Return:

- changed files
- agents or bounded passes used
- memory-master / context-master dispatches
- commands run
- browser/API evidence when applicable
- review findings
- remaining risks
- updated heartbeat status
