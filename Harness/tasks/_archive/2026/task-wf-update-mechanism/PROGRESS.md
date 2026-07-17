# wf-update-mechanism — PROGRESS

## Current Goal

Fix CRITICAL PLAN.md reference bugs + implement `/wf update` GitHub-based incremental update mechanism.

## Phase

Current: Done (deliverables shipped: /wf-update command + skill + .harness-version live in repo; archived 2026-07-16)

## Heartbeat

Last beat: 2026-06-25 00:00
Current phase: Build
Current blocker: none
Next beat trigger: after subagents return + validator + npm test
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Fix 3 controller write-target bugs + 13 stale PLAN.md refs | subagent A | grep check | In Progress |
| 2 | Create wf-update skill + command + version file template | subagent B | file existence | In Progress |
| 3 | Register update skill in MEMORY.md + README.md + validator | subagent C | validator passes | In Progress |
| 4 | Sync templates + dogfood | main agent | strict validator + npm test | Pending |
