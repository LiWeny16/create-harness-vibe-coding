---
name: wf-mode
description: Use for /wf, wf mode, workflow mode, long difficult tasks, multi-file or multi-agent work, low-confidence decisions, repeated failures, migrations, architecture-heavy changes, browser-visible work, or any task that needs exploration -> second plan -> implementation -> review -> verification -> recovery.
---

# WF Mode

Load:

- `Harness/WF.md`
- `Harness/PLAN.md`
- `Harness/agent-workflow.md` when implementation, review, or verification starts
- `Harness/subagents.md`, `Harness/dispatch.md`, and `Harness/context-loading.md` only when coordinating subagents or bounded role passes
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
-> debugger recovery loop when verification fails
-> close with evidence
```

Rules:

- Update `Harness/PLAN.md#Heartbeat` before long commands, after failures, before handoff, and at closeout.
- Use `subagent-orchestrator` and `Harness/subagents.md` when the task has broad reading, cross-layer impact, independent review needs, or repeated failures.
- If subagents are unavailable, emulate the same roles as separate bounded passes.
- Do not claim browser/UI acceptance without real-browser evidence from Chrome DevTools, CDP, Playwright, or documented manual browser checks.
- If `Harness/workflows/browser-e2e.md` is not installed, use `Harness/WF.md#Browser And API Evidence` as the fallback evidence contract or ask the user before adding the optional workflow.
- If the same failure class happens three times, stop blind fixes and ask the user with evidence-backed options.

Return:

- changed files
- agents or bounded passes used
- commands run
- browser/API evidence when applicable
- review findings
- remaining risks
- updated heartbeat status
