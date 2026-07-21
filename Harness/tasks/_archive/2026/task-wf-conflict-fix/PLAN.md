# wf-conflict-fix — PLAN

## Goal

Fix Harness WF-mode orphaned files, resolve subagent count tension, align "may"/"MUST", add memory-master + context-master.

## Acceptance Criteria
- [x] commands/wf.md requires subagent-orchestrator + >=3 agents
- [x] agent-workflow.md + dispatch.md have WF override notes
- [x] README.md says "MUST" not "may"
- [x] memory-master.md and context-master.md exist and are registered
- [x] WF.md, wf-mode/SKILL.md have memory/context triggers
- [x] Strict validator passes
- [x] 58/58 tests pass

## Subagent Dispatch
| Agent | Mode | Write Set | Status |
|-------|------|-----------|--------|
| Subagent 1 (template) | Write | agents + commands/wf.md | Verified |
| Subagent 2 (template) | Write | agent-workflow + dispatch + README | Verified |
| Subagent 3 (template) | Write | WF + wf-mode + subagents + MEMORY + context-loading + CLAUDE + validator | Verified |
| Subagent 4 (dogfood sync) | Write | 10 dogfood files | Verified |

## Verification
| Check | Result |
|-------|--------|
| `node Harness/scripts/validate-harness.mjs --strict` | Pass |
| `npm test` | Pass (58/58) |
