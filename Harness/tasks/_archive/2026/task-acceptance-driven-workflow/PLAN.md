# task-acceptance-driven-workflow - PLAN

Task-level implementation plan and evidence. Main agent writes after second planning; implementer reads before coding.

## Goal

Upgrade the Harness scaffold from implementation-driven workflow language to an acceptance-driven agent workflow: Mini PRD -> acceptance criteria -> executable acceptance tests/contracts -> implementation -> independent validation -> debug -> memory.

## Acceptance Criteria

- [x] Harness docs define PRD-derived acceptance criteria as the source of truth.
- [x] WF, WF-MAX, and WF-AUTO share the same acceptance-driven mother flow while preserving their organizational differences.
- [x] Agent role isolation, context isolation, and permission isolation are documented as hard rules.
- [x] UI/API contracts, test-only Harness Bridge, Playwright/CDP validation, and acceptance result matrices are documented.
- [x] Scaffold templates and dogfood runtime docs stay in sync for changed files.
- [x] Harness validation runs or any blocker is recorded.
- [x] TDD guidance and agent/skill entry points require AC-linked RED tests, real UI actions for browser-visible behavior, Playwright/CDP network evidence for frontend-backend flows, and explicitly forbid syntax-only acceptance.
- [x] Scenario memory hints are documented with bounded, relevant context-loading rules. The earlier broad hook protocol was later replaced by the `/wf-auto`-only hook exception in `task-remove-hook-docs`.

## Scope

Allowed write set:
- `Harness/*.md`
- `Harness/MEMORY.md`
- `Harness/SETUP.md`
- `Harness/research/PRD.md`
- `Harness/workflows/browser-e2e.md`
- `Harness/scripts/validate-harness.mjs`
- `Harness/scripts/wf-remove.mjs`
- `Harness/memory/agent-lessons-patterns.md`
- `Harness/tasks/_template/*.md`
- `Harness/tasks/task-acceptance-driven-workflow/*`
- `.claude/skills/tdd/SKILL.md`
- `.agents/skills/tdd/SKILL.md`
- `.claude/agents/tdd-guide.md`
- `.claude/agents/test-writer.md`
- `.claude/agents/memory-master.md`
- `.claude/agents/context-master.md`
- `.agents/agents/tdd-guide.md`
- `templates/common/Harness/*.md`
- `templates/common/Harness/research/PRD.md`
- `templates/common/Harness/tasks/_template/*.md`
- `templates/common/MEMORY.md`
- `templates/common/SETUP.md`
- `templates/common/scripts/validate-harness.mjs`
- `templates/common/scripts/wf-remove.mjs`
- `templates/common/.claude/skills/tdd/SKILL.md`
- `templates/common/.claude/agents/tdd-guide.md`
- `templates/common/.claude/agents/test-writer.md`
- `templates/common/.claude/agents/memory-master.md`
- `templates/common/.claude/agents/context-master.md`
- `templates/optional/skills/browser-e2e/Harness/workflows/browser-e2e.md`

Forbidden:
- Source implementation under `src/`, `bin/`, and tests except validation commands.
- Existing unrelated user changes in dirty files.
- Production code or runtime-interceptor behavior changes.

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `Harness/WF-MAX.md`
- `Harness/WF-AUTO.md`
- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`
- `Harness/agent-workflow.md`
- `.agents/skills/wf/SKILL.md`
- `.agents/skills/subagent-orchestrator/SKILL.md`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| planner-pass | Read | Current Harness routers, WF docs, task templates | none | Integrated |
| acceptance-test-pass | Read | PRD, agent workflow, browser E2E routing, task templates | none | Integrated |
| architect-review-pass | Read | Runtime/template source layout, WF-MAX/WF-AUTO boundaries | none | Integrated |

## Subagent Synthesis

Agents used: planner-pass, acceptance-test-pass, architect-review-pass. Real subagent runtime unavailable in this Codex surface, so these were bounded read-only passes following `Harness/subagents.md`.
Findings accepted:
- Add first-class acceptance protocol docs instead of burying the rules inside WF prose.
- Make PRD-derived AC IDs the source of truth across code, tests, review, debug, and memory.
- Add role/context/permission isolation as hard rules, not reviewer etiquette.
- Add test-only Harness Bridge guidance for UI selectors, API contracts, seeded data, runtime probes, and network traces.
- Keep runtime `Harness/` and scaffold source `templates/common/Harness/` in sync.
Findings rejected:
- Do not add new `.claude/agents/*` role files in this pass; map Acceptance, Contract, Validator, and Debug roles through existing planner/test-writer/reviewer/verifier/debugger contracts first.
- Do not change production source or runtime-interceptor behavior; this is a protocol/spec upgrade.
Conflicts:
- Existing worktree has unrelated dirty changes in router, validator, runtime interception, and tests. Preserve those changes and only add acceptance-workflow deltas.
Decisions:
- Add `ACCEPTANCE_PROTOCOL.md`, `AGENT_ISOLATION.md`, `HARNESS_BRIDGE.md`, `DEBUG_PROTOCOL.md`, `MEMORY_PROTOCOL.md`, and `Harness/templates/*`.
- Update WF, WF-MAX, WF-AUTO, lifecycle, agent workflow, subagents, dispatch, context loading, README router, and task/PRD templates.
Residual risk:
- Validator coverage for the new docs may require a follow-up if current unrelated validator edits conflict with adding required-file assertions.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `node Harness/scripts/validate-harness.mjs` | Passed | Harness validation passed after adding required protocol/template checks. |
| `node Harness/scripts/validate-harness.mjs --strict` | Passed | Strict placeholder scope passed after PRD AC-006 completion update. |
| `npm run build:version` | Passed | `templates/common/.harness-version` rebuilt with 78 checksums and 93 source entries. |
| `npm test` | Passed | 65 passed, 1 skipped. |
| Generated scaffold validator | Passed | Temporary scaffold validator passed at `%TEMP%/harness-acceptance-2b12fbe6421f497d87ad423d36fe2972`. |
| `npm run build:version` | Passed | Rebuilt after TDD and memory protocol changes; later no-hook cleanup superseded hook-specific output. |
| `node Harness/scripts/validate-harness.mjs` | Passed | Validator checks TDD real UI rules and memory protocol routing. |
| `node Harness/scripts/validate-harness.mjs --strict` | Passed | Strict placeholder scope passed. |
| `npm test` | Passed | 65 passed, 1 skipped. |
| Generated scaffold validator | Passed | Temporary scaffold validator passed. Broad runtime-interceptor assertions were later removed by `task-remove-hook-docs`. |

## Acceptance Result

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `Harness/ACCEPTANCE_PROTOCOL.md`, router/workflow docs | PRD-derived AC source-of-truth rule documented and routed. |
| AC-002 | PASS | `Harness/WF.md`, `Harness/WF-MAX.md`, `Harness/WF-AUTO.md` | Modes share mother flow with organizational differences. |
| AC-003 | PASS | `Harness/AGENT_ISOLATION.md`, `Harness/subagents.md`, `Harness/dispatch.md` | Role/context/permission isolation documented. |
| AC-004 | PASS | `Harness/HARNESS_BRIDGE.md`, `Harness/workflows/browser-e2e.md`, `Harness/templates/*` | UI/API contracts, Playwright/CDP, validation report templates added. |
| AC-005 | PASS | `templates/common/Harness/*`, `templates/common/.harness-version` | Runtime/template source synced and version manifest rebuilt. |
| AC-006 | PASS | validator/test commands above | Scaffold validation and generated scaffold validation passed. |
| AC-007 | PASS | `Harness/TDD-GUIDE.md`, `.claude/agents/test-writer.md`, `.claude/agents/tdd-guide.md`, `.claude/skills/tdd/SKILL.md`, validator checks | TDD now requires AC-linked RED tests, real UI actions, Playwright/CDP evidence, and forbids syntax-only UI acceptance. |
| AC-008 | SUPERSEDED | `Harness/WF-AUTO.md`, `Harness/MEMORY_PROTOCOL.md`, router docs, validator checks | Broad hook protocol was removed by `task-remove-hook-docs`; `/wf-auto` now owns the only optional bounded hook exception, and scenario memory hints remain non-hook. |
