# task-wf-remove-residual-cleanup - PROGRESS

## Current Goal

Fix `/wf-remove` residual `.claude` / `.agents` / `.codex` cleanup.

## Phase

Current: Verified

## Heartbeat

Last beat: 2026-07-02 fixed legacy built-in discovery cleanup, script-root targeting, and `/wf-remove` skill entry wording.
Current phase: Verified
Current blocker: none
Next beat trigger: publish or release request
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Reproduce residual cleanup failure | main agent | red e2e | Done |
| 2 | Fix known built-in legacy cleanup | main agent | e2e | Done |
| 3 | Fix script-root targeting safety | main agent | e2e | Done |
| 4 | Verify generated-project uninstall | main agent | temp smoke | Done |
| 5 | Clarify `/wf-remove` is user-facing entry | main agent | strict validator | Done |

## Agent Handoffs

| Agent | Role | Context Pack | Result |
|-------|------|--------------|--------|
