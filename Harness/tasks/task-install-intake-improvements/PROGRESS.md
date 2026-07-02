# install-intake-improvements - PROGRESS

Task-level progress and heartbeat. Main agent updates; subagents read only.

## Current Goal

Find and fix why the scaffold install flow does not guide agents to scan the project root, ask enough optional install questions, handle an existing `Harness/` folder, support Codex-friendly non-text selection, and keep the agent-link install prompt short while moving detailed rules into README/SETUP.

## Phase

Current: Verified

## Heartbeat

Last beat: 2026-07-01
Current phase: Verified
Current blocker: none
Next beat trigger: task closed
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Inspect install prompt/docs/generator behavior | main agent | file references in PLAN.md | Done |
| 2 | Add or update regression tests for intake/root-scan/optional choices | main agent | failing then passing tests | Done |
| 3 | Implement scaffold/docs changes | main agent | npm test + validator | Done |
| 4 | Review diff and record evidence | main agent | PLAN verification table | Done |
| 5 | Refine agent-link prompt, install/upgrade path, and external recommendation links for 0.8.1 | main agent | npm test + validators + pack dry-run | Done |

## Agent Handoffs

| Agent | Role | Context Pack | Result |
|-------|------|-------------|--------|
| bounded-pass: planner | map files and behavior | README, src, tests, templates | Done: found weak agent-link root scan and no CLI optional prompt |
| bounded-pass: architect | identify ownership boundaries | generator/prompts/templates | Done: kept `npx` install-only and update flow agent-mediated |
| bounded-pass: reviewer | check user-facing risks | diff + tests | Done: verified tests cover Harness-only paths, recommendations, and Codex entries |
