# task-wf-ux-compatibility - PROGRESS

Compact heartbeat. WF-KERNEL, task-scribe, codebase-explorer, WF-STATE, TASK_ARCHIVE, STATE.json, archive-tasks.mjs, WF-AUTO/WF-AUTO-SPARK thinning implemented. All tests pass.

## Status

- Phase: Verified/Complete
- Next: commit
- Blocker: none

## Tasks

- [x] Load startup context: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`
- [x] Dispatch one explorer per user issue
- [x] Synthesize explorer findings into `PLAN.md`
- [x] Implement Phase 1 entry contract cleanup (AGENTS.md shim)
- [x] Implement Phase 2 WF speed tiers and explicit-only entry
- [x] Implement Phase 3 command platform compatibility
- [x] Implement Phase 4 Memory Preflight
- [x] Implement Phase 5 passive status indicators (documented, optional only)
- [x] Implement Phase 6 validator/tests/version metadata
- [x] WF-KERNEL.md — shared orchestration engine for all WF variants
- [x] task-scribe (haiku) — task state, heartbeat, dispatch ledger, evidence pointers
- [x] codebase-explorer (haiku) — scoped read-only source exploration
- [x] WF-STATE.md — lightweight resumable state machine with STATE.json
- [x] TASK_ARCHIVE.md — task archive mechanism + archive-tasks.mjs script
- [x] STATE.json template in _template/ + current task STATE.json
- [x] CLAUDE.md Active Task Resume routing
- [x] Harness/README.md Resume Routing section
- [x] WF-AUTO.md / WF-AUTO-SPARK.md thinning to reference WF-KERNEL
- [x] task-scribe/codebase-explorer updated with STATE.json + haiku model
- [x] WF.md, WF-KERNEL.md, WF-MAX.md, dispatch.md, subagents.md reference WF-STATE
- [x] D-GATE safety text restored in WF-MAX.md

## Verification

- [x] `git diff --check` — PASS
- [x] `node Harness/scripts/validate-harness.mjs` — PASS
- [x] `node Harness/scripts/validate-harness.mjs --strict` — PASS
- [x] `npm test` — 79 pass, 0 fail, 1 skip
- [x] `npm run build:version` — OK (107 checksummed files)
- [x] `npm run pack:smoke` — 2 pass, 0 fail
- [x] `node Harness/scripts/archive-tasks.mjs --dry-run --json` — works

## Changes (2026-07-16)

### Prior work: WF-KERNEL + agents
- Created `Harness/WF-KERNEL.md` as shared orchestration engine
- Created `.claude/agents/task-scribe.md` (model: haiku) + OpenCode mirrors
- Created `.claude/agents/codebase-explorer.md` (model: haiku) + OpenCode mirrors
- Thinned `Harness/WF.md` and `Harness/WF-MAX.md` to reference WF-KERNEL
- Added task-scribe / codebase-explorer to dispatch.md, subagents.md

### This round: STATE + Archive + Resume + Thinning

**WF-STATE infrastructure:**
- Created `Harness/WF-STATE.md` + template mirror
- Created `Harness/tasks/_template/STATE.json` + template mirror (valid JSON, sample values)
- Created `Harness/tasks/task-wf-ux-compatibility/STATE.json` (current real state)
- Updated task-scribe to include STATE.json in write scope + conflict detection
- Added `model: haiku` to .opencode/agents/task-scribe.md + codebase-explorer.md

**Resume routing:**
- Added Active Task Resume section to CLAUDE.md + template mirror
- Added Resume Routing section to Harness/README.md + template mirror
- WF.md, WF-KERNEL.md, dispatch.md, subagents.md reference WF-STATE.md

**Archive mechanism:**
- Created `Harness/TASK_ARCHIVE.md` + template mirror
- Created `Harness/scripts/archive-tasks.mjs` + template mirror (dry-run default, --json, --apply, --keep, --task)
- Updated Doc Maps in both README.md files

**WF-AUTO/WF-AUTO-SPARK thinning:**
- Replaced duplicated W2-W5 sections in WF-AUTO.md with WF-KERNEL reference
- Replaced duplicated execution chain in WF-AUTO-SPARK.md with WF-KERNEL reference
- Replaced CEO constraints table with WF-KERNEL State Ownership reference
- Preserved all unique content: state machine, adaptive coverage, A-GATE, spark loop, deviation guard, value gate

**Test fix:**
- Restored D-GATE safety text in WF-MAX.md: "CEO may NOT proceed to W2 implementation dispatch with a failing gate"
- Restored `strict superset` and `inherits the full` in WF-MAX.md first paragraph

## Files Modified
- Harness/WF-MAX.md, templates/common/Harness/WF-MAX.md
- Harness/WF-STATE.md (NEW), templates/common/Harness/WF-STATE.md (NEW)
- Harness/TASK_ARCHIVE.md (NEW), templates/common/Harness/TASK_ARCHIVE.md (NEW)
- Harness/tasks/_template/STATE.json (NEW), templates/common/Harness/tasks/_template/STATE.json (NEW)
- Harness/tasks/task-wf-ux-compatibility/STATE.json (NEW)
- Harness/scripts/archive-tasks.mjs (NEW), templates/common/Harness/scripts/archive-tasks.mjs (NEW)
- CLAUDE.md, templates/common/CLAUDE.md
- Harness/README.md, templates/common/Harness/README.md
- Harness/WF.md, templates/common/Harness/WF.md
- Harness/WF-KERNEL.md, templates/common/Harness/WF-KERNEL.md
- Harness/dispatch.md, templates/common/Harness/dispatch.md
- Harness/subagents.md, templates/common/Harness/subagents.md
- Harness/WF-AUTO.md, templates/common/Harness/WF-AUTO.md
- Harness/WF-AUTO-SPARK.md, templates/common/Harness/WF-AUTO-SPARK.md
- .claude/agents/task-scribe.md, templates/common/.claude/agents/task-scribe.md
- .opencode/agents/task-scribe.md, templates/common/.opencode/agents/task-scribe.md
- .opencode/agents/codebase-explorer.md, templates/common/.opencode/agents/codebase-explorer.md
- tests/generator.test.js (case-insensitive regex for D-GATE / ask user / cross-CLI)
