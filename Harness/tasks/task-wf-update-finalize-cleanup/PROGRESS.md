# task-wf-update-finalize-cleanup - PROGRESS

Task-level progress and heartbeat. Main agent updates; subagents read only.

## Current Goal

Upgrade `wf-update` so script-owned update mechanics match install/remove: missing and dead files are handled by scripts, true semantic conflicts are left to AI, and metadata finalizes without residue.

## Phase

Current: Verified

## Heartbeat

Last beat: 2026-07-03 - Added optional-aware scan/update guards, refreshed dogfood manifest, removed workflow residue; e2e, npm test, strict validator, build-version, local scan-clean passed.
Current phase: Verified
Current blocker: none
Next beat trigger: closeout
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Define goal, ACs, and write set | main agent | PLAN.md | Done |
| 2 | Dispatch parallel command audit explorers | main agent | subagent IDs and returned reports | Done |
| 3 | Add RED tests for adopted byte-match, finalize, and command cleanup scope | test-writer fallback | `node tests/e2e-wf-scripts.test.mjs` fails expected assertions | Done |
| 4 | Implement minimal script behavior | implementer fallback | targeted e2e passes | Done |
| 5 | Sync template scripts | implementer fallback | package tests and generated checks | Done |
| 6 | Run validation and review | reviewer/verifier fallback | `npm test`, strict validator | Done |

## Agent Handoffs

| Agent | Role | Context Pack | Result |
|-------|------|-------------|--------|
| planner | bounded pass | request + Harness update contract | ACs and write set recorded in PLAN |
| architect | bounded pass | update/remove/scan script behavior | accepted script-owned metadata/finalize design |
| test-writer | bounded pass | PLAN ACs + e2e tests | RED failed 7 expected assertions; GREEN passed 161/161 |
| install-generator-auditor | explorer subagent | install/generator commands | PARTIAL: strong dry-run JSON/safe merge; gaps are installed-Harness hard stop, transactional writes, scan depth |
| workflow-command-auditor | explorer subagent | workflow command adapters/docs | PARTIAL: strong gates; gaps are WF-MAX D-GATE ordering, durable review/readme evidence, some load breadth |
| remove-clean-auditor | explorer subagent | remove/cleanup commands | PARTIAL: wf-remove strong; scan-clean needs command scope/source-base parity and richer residual JSON |
| auto-tdd-optional-auditor | explorer subagent | auto/tdd/optional command surface | PARTIAL: TDD/AC strong; wf-auto adapter/spec mismatch, auto-spark budget risk, guardrail tests missing |
