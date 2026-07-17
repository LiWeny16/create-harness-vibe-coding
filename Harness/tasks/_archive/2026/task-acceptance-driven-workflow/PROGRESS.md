# task-acceptance-driven-workflow - PROGRESS

Task-level progress and heartbeat. Main agent updates; subagents read only.

## Current Goal

Upgrade Harness workflow docs and templates to make PRD-derived acceptance criteria the highest source of truth.

## Phase

Current: Verified (closed 2026-07-02 per Harness/PROGRESS.md Task Index; capsule phase was never updated)

## Heartbeat

Last beat: 2026-07-02 - Validation passed after TDD/E2E hardening and scenario memory protocol updates. Broad runtime-interceptor output was later superseded by `task-remove-hook-docs`.
Current phase: Verified
Current blocker: none
Next beat trigger: closeout complete
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Load routed Harness context | main agent | files read | Done |
| 2 | Run bounded planner / acceptance-test / architect-review passes | main agent | synthesis in PLAN.md | Done |
| 3 | Patch runtime Harness docs | implementer-pass | diff review | Done |
| 4 | Patch template Harness docs | implementer-pass | runtime/template comparison | Done |
| 5 | Validate scaffold | verifier-pass | command output | Done |
| 6 | Harden TDD guide, tdd skill, and tdd-guide agent for real UI acceptance | main agent | validator checks | Done |
| 7 | Add scenario memory protocol; broad runtime-interceptor output later superseded | main agent | validator checks | Superseded |
| 8 | Rebuild version metadata and rerun validation | verifier-pass | command output | Done |

## Verification Evidence

| Command | Result | Notes |
|---------|--------|-------|
| `node Harness/scripts/validate-harness.mjs` | PASS | Harness validation passed. |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Strict placeholder scope passed. |
| `npm run build:version` | PASS | Template version manifest rebuilt. |
| `npm test` | PASS | 65 passed, 1 skipped. |
| generated scaffold `node Harness/scripts/validate-harness.mjs` | PASS | Temp scaffold validator passed. |
| `npm run build:version` | PASS | Rebuilt after TDD and memory protocol changes; broad runtime-interceptor output later superseded. |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Strict placeholder scope passed. |
| `npm test` | PASS | 65 passed, 1 skipped. |
| generated scaffold `node Harness/scripts/validate-harness.mjs` | PASS | Temp scaffold validator passed; broad runtime-interceptor assertions later superseded. |

## Agent Handoffs

| Agent | Role | Context Pack | Result |
|-------|------|-------------|--------|
| bounded-context-master | Closeout extraction | task PLAN/PROGRESS, changed protocol docs, verification output | Durable lesson identified: AC IDs are workflow truth. |
| bounded-memory-master | Memory write | extracted lesson, memory protocol | Wrote `Harness/memory/agent-lessons-patterns.md` entry. |
