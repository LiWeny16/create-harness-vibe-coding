# /wf-help

Return this help table directly. Do not invoke a skill, do not start WF mode,
do not dispatch agents, and do not edit files.

| Command | Type | Usage | Purpose |
| --- | --- | --- | --- |
| `/wf-help` | direct command | `/wf-help` | Show this command table. |
| `/wf <task>` | workflow skill | `/wf fix failing login flow` | Standard acceptance-driven workflow for long, uncertain, multi-file, browser/API, or recovery work. |
| `/wf-max <task>` | workflow skill | `/wf-max refactor auth module` | WF strict superset: complete role chain plus maximum fan-out, CEO -> Manager -> Worker dispatch, cross-CLI overflow when the current runtime agent pool is exhausted. |
| `/wf-auto` | workflow skill | `/wf-auto` | Perpetual auto-optimization loop using bounded cycles, 8-angle exhaustion, evidence ledger, and optional wf-auto-only tick hook. |
| `/wf-auto-spark` | workflow skill | `/wf-auto-spark` | Perpetual inspiration mode with roadmap anchoring and external spark search. |
| `/wf-review <focus>` | workflow skill | `/wf-review security and test coverage` | Cross-model peer review through the other CLI; use for second opinions and risk checks. |
| `/wf-learn` | workflow skill | `/wf-learn` | Force context-master -> memory-master learning cycle after repeated failures or closeout. |
| `/wf-readme <task>` | workflow skill | `/wf-readme polish quickstart` | Preserve, merge, or improve README docs without trampling existing project documentation. |
| `/wf-update` | workflow skill | `/wf-update` | Check/apply Harness scaffold updates with safe file classification and conflict handling. |
| `/wf-remove` | workflow skill | `/wf-remove` | Safely remove Harness files while preserving project/user data unless explicitly purged. |

Source of truth: `Harness/README.md#Skill Commands` plus installed skills under
`.claude/skills/`.
