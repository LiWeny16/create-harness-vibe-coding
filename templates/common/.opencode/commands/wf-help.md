---
description: Show the Harness WF command table
---

Return this help table directly. Do not invoke a skill, do not start WF mode,
do not dispatch agents, and do not edit files.

| Command | Type | Usage | Purpose |
| --- | --- | --- | --- |
| `/wf-help` | direct command | `/wf-help` | Show this command table. |
| `/wf <task>` | workflow skill | `/wf fix failing login flow` | Tiered WF: WF-Light (low-risk, planner/test/verifier), WF-Standard (multi-file, compact ACs), WF-Full (high-risk/cross-layer, full role chain). |
| `/wf-max <task>` | workflow skill | `/wf-max refactor auth module` | WF-Max-Useful default (fan-out only where independent), WF-Max-Strict override (unconditional fan-out). |
| `/wf-auto` | workflow skill | `/wf-auto` | Perpetual adaptive auto-optimization using project evidence, dynamic probes, risk obligations, evidence ledger, and confirmation-based exhaustion. |
| `/wf-auto-spark` | workflow skill | `/wf-auto-spark` | Perpetual inspiration mode with roadmap anchoring and external spark search. |
| `/wf-review <focus>` | workflow skill | `/wf-review security and test coverage` | Cross-model peer review through the other CLI; use for second opinions and risk checks. |
| `/wf-learn` | workflow skill | `/wf-learn` | Force context-master -> memory-master learning cycle after repeated failures or closeout. |
| `/wf-readme <task>` | workflow skill | `/wf-readme polish quickstart` | Preserve, merge, or improve README docs without trampling existing project documentation. |
| `/wf-update` | direct command | `/wf-update` | Check/apply Harness scaffold updates with safe file classification and conflict handling. |
| `/wf-remove` | workflow skill | `/wf-remove` | Safely remove Harness files while preserving project/user data unless explicitly purged. |

Source of truth: `Harness/README.md#Skill Commands` plus installed skills under
`.claude/skills/` (Claude Code) or `.agents/skills/` (Codex). In OpenCode the
same skills load from `.claude/skills/`, `.agents/skills/`, and `.opencode/skills/`.
