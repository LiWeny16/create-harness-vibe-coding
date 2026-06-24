# PLAN.md -- DEPRECATED

Workflow state has moved to task-capsule structure. Do not append new content here.

Active state:
- `Harness/PROGRESS.md` -- global task index and cross-task decisions
- `Harness/tasks/<task-id>/PROGRESS.md` -- per-task progress, phase, heartbeat
- `Harness/tasks/<task-id>/PLAN.md` -- per-task implementation plan, verification evidence

Templates:
- `Harness/tasks/_template/` -- copy this directory to create a new task

## Legacy Content (historical reference only)

The sections below are archived from the monolithic PLAN.md era. Active task data has been migrated to `Harness/tasks/`.

---

### Historical: Dogfood Bootstrap

Goal: Dogfood the generated Harness scaffold inside this repository so future agents use root `Harness/` routing instead of stale `docs/harness/` guidance.

**Success Criteria** (all verified):
- [x] Root `CLAUDE.md` routes through `Harness/MEMORY.md` and `Harness/README.md`
- [x] Root `MEMORY.md` no longer contains stale `docs/harness/` paths or template placeholders
- [x] Root `Harness/` and `.claude/` dogfood runtime assets exist
- [x] Harness strict validation passes
- [x] Repository tests pass

**Decisions:**
| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-24 | Dogfood root `Harness/` while keeping templates under `templates/` | Separate package source from operating harness |
| 2026-06-24 | memory-master + context-master added to commonAgents | Global memory and context management |

### Historical: WF Conflict Fix

Goal: Fix WF-mode orphaned files and conflicts: align commands/wf.md, resolve subagent count tension, fix README "may" vs "MUST", add memory-master and context-master agents.

**Subagent Dispatch:**
| Agent | Mode | Purpose | Status |
|-------|------|---------|--------|
| Subagent 1 | Serial Write | Create memory-master.md, context-master.md, update commands/wf.md | Verified |
| Subagent 2 | Serial Write | Fix agent-workflow.md, dispatch.md, README.md conflicts | Verified |
| Subagent 3 | Serial Write | Update WF.md, wf-mode/SKILL.md, subagents.md, MEMORY.md, context-loading.md, CLAUDE.md, validate-harness.mjs | Verified |
| Subagent 4 | Serial Write | Sync template changes to dogfood runtime files | Verified |

**Verification:**
| Check | Result | Notes |
|-------|--------|-------|
| `node Harness/scripts/validate-harness.mjs --strict` | Pass | all invariants preserved |
| `npm test` | Pass | 58/58 tests passed |
