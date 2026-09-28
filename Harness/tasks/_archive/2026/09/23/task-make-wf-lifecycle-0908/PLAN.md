# task-make-wf-lifecycle-0908 - PLAN

## Goal

Implement explicit WF activation, durable cross-session resume, no direct-to-WF promotion, no WF exit/downgrade, and ensure wf-ui project/task views consume the same project/task state and indexes. Preserve compatibility and keep the architecture minimal.

## Scope

Write set:
- Harness/scripts/task-state.mjs
- templates/common/Harness/scripts/task-state.mjs
- src/wf-ui-server/task-parser.mjs
- src/wf-ui-server/a2a-store.mjs
- src/ui/src/components/TaskList.tsx
- src/ui/src/components/Header.tsx
- CLAUDE.md
- templates/common/CLAUDE.md
- Harness/specs/workflows/WF.md
- Harness/specs/workflows/WF-STATE.md
- tests/task-state.test.js
- src/wf-ui-server/__tests__/task-parser.test.mjs
- src/wf-ui-server/__tests__/server.integration.test.mjs
- src/ui/src/components/WorkflowRoute.tsx
- .claude/commands/wf-learn.md
- .opencode/commands/wf-learn.md
- templates/common/.claude/commands/wf-learn.md
- .claude/skills/wf-learn/SKILL.md
- .agents/skills/wf-learn/SKILL.md
- templates/common/.claude/skills/wf-learn/SKILL.md
- tests/wf-learn-contract.test.js

Forbidden:
- Do not add a daemon, database, second task registry, or alternate lifecycle state source.
- Do not change direct task behavior into WF behavior implicitly.
- Do not remove legacy status/mode aliases or compatibility command surfaces.
- Do not use an external CLI for review or lifecycle management.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Derive durable task WF management from the existing task `mode` field; only `wf` and `wf-max` are task-owning managed modes. `wf-auto`/`wf-auto-spark` remain explicit capabilities with their own continuous capsule and never adopt a normal task. | Keeps one canonical state source, honors explicit activation, and prevents an auto capability from silently taking over task lifecycle. | 2026-09-08 |
| 2 | A direct task can never be promoted to a managed WF task; an open managed task cannot downgrade. | Makes explicit activation and close-then-new semantics enforceable. | 2026-09-08 |
| 3 | `wf-ui` reads the same `STATE.json` fields and active pointer as the CLI, with derived project/task metadata only. | Avoids a second UI lifecycle model and supports on-demand context loading. | 2026-09-08 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Explicit WF activation is durable: managed modes are visible in task list/open/index/UI, and an active or blocked managed task is marked for automatic resume on the next session. | `tests/task-state.test.js`, parser/server tests, strict validation | passed |
| AC-002 | Direct tasks remain direct forever; an existing managed WF task cannot be downgraded or exited, and only `closed` permits starting a new task capsule. | `tests/task-state.test.js`, server binding test | passed |
| AC-003 | Existing `active`, `blocked`, and `closed` lifecycle statuses remain canonical while legacy aliases remain readable and normalized. | `tests/task-state.test.js`, full test suite | passed |
| AC-004 | `wf-ui` project/task views consume project, tags, dates, status, mode, active/resume metadata from the canonical task state and expose the relationship without a second store. | UI source, parser/server tests, live API check, production typecheck/build | passed |

| AC-005 | `wf-learn` is an explicit command contract with an anti-overfitting gate: instance facts remain task-local, durable candidates use Probe -> Identify -> Act -> Verify, and critical memory load is reported rather than assumed. | `tests/wf-learn-contract.test.js` | passed |
| AC-006 | Skills Hub has no Market/install surface and the production bundle is regenerated from the current source. | `pnpm --dir src/ui typecheck`, `pnpm --dir src/ui build`, grep for Market wiring | passed |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| UI payload compatibility | Add fields without removing existing parser keys; old fixtures remain valid. | mitigated |
| Legacy capsules have no mode | Normalize missing mode to `direct`; never infer WF from complexity or active pointer. | mitigated |
| Existing Skills Market UI integration is not type-safe/buildable | Removed stale Market wiring from the Hub surface while keeping the standalone module on disk for compatibility; rebuilt the UI bundle. | mitigated |
