# PLAN.md - Active Execution Plan

Use this file when work spans more than one step, one file, or one agent.

## Current Goal

{{CURRENT_GOAL}}

## Phase

Choose one: Idea / Research / PRD / Architecture / Plan / Build / Verify / Feedback.

Current: {{CURRENT_PHASE}}

## Heartbeat

Mode: normal
Last beat: {{LAST_BEAT}}
Current phase: {{CURRENT_PHASE}}
Current blocker: {{CURRENT_BLOCKER_OR_NONE}}
Next beat trigger: {{NEXT_BEAT_TRIGGER}}
Failure count: 0
Recovery action: {{RECOVERY_ACTION_OR_NONE}}

Update this section before long commands, after long commands, before and after subagent handoffs, after failed verification, and before stopping for user input. In `wf-mode`, use this as the resume point after context loss or interruption.

## Progress Rules

- Phase tracks lifecycle progress.
- Task status tracks execution progress.
- Update before handoff, after verification, and when blocked.

Allowed task statuses: Pending / In Progress / Blocked / Done / Verified.

- Pending: not started.
- In Progress: active work.
- Blocked: needs user input or external change.
- Done: task complete, evidence not final.
- Verified: verification evidence is recorded.

## Success Criteria

- [ ] {{CRITERION_1}}
- [ ] {{CRITERION_2}}
- [ ] {{CRITERION_3}}

## Scope

Allowed write set:
- `{{PATH_OR_GLOB}}`

Forbidden:
- {{OUT_OF_SCOPE}}

## Loaded Context

Keep this list short. Add only docs/files used for the current phase.

- `Harness/README.md`
- `{{LOADED_DOC_OR_FILE}}`

## Tasks

| # | Task | Owner | Verify | Status |
| --- | --- | --- | --- | --- |
| 1 | {{TASK}} | {{OWNER}} | `{{COMMAND_OR_CHECK}}` | Pending |

## Parallel Dispatch

Use [subagents.md](subagents.md) and [dispatch.md](dispatch.md) when more than one agent or bounded pass is useful.

| Task | Agent | Mode | Read Set | Write Set | Depends On | Output | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{TASK}} | {{AGENT}} | Parallel Read / Serial Write / Isolated Worktree | `{{READ_SET}}` | `{{WRITE_SET_OR_NONE}}` | {{DEPENDENCY_OR_NONE}} | {{EXPECTED_OUTPUT}} | Pending |

## Subagent Synthesis

Agents used:
Findings accepted:
Findings rejected:
Conflicts:
Decisions:
Next write set:
Verification path:
Residual risk:

## Agent Handoffs

| Agent | Role | Context Pack | Result |
| --- | --- | --- | --- |
| {{AGENT}} | {{ROLE}} | {{DOCS_OR_FILES}} | {{SUMMARY}} |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| {{YYYY-MM-DD}} | {{DECISION}} | {{REASON}} |

## Verification

| Check | Result | Notes |
| --- | --- | --- |
| `{{CHECK}}` | Not run | {{NOTES}} |
