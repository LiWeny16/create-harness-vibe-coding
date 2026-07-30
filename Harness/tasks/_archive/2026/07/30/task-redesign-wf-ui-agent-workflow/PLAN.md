# task-redesign-wf-ui-agent-workflow - PLAN

## Goal

- Outcome: Redesign the Harness control panel so `Agents` is a detected terminal-agent launcher/terminal manager, `Workflow` is an agent-terminal orchestration canvas, and existing role displays move to `Roles`.
- Non-goals: Do not show unavailable Agent IDEs. Do not require users to supply runtime/task just to start an agent. Do not depend on Claude/Codex/OpenCode native subagent orchestration for Harness workflows.

## Scope

- Write set: `src/ui`, `src/wf-ui-server`, `Harness/a2a`, mirrored template files only if needed for generated Harness installs, focused tests.
- Forbidden: unrelated scaffold refactors, destructive git cleanup, changes outside Harness-owned workflow/terminal UI behavior.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D-001 | `Agents` route starts detected terminal CLI platforms directly. | User wants a plus-box launcher like CC switch, not a runtime/task form. | 2026-07-30 |
| D-002 | `Workflow` route uses a full canvas of Harness terminal agent nodes. | User wants visible workflow orchestration and workflow creation/run behavior. | 2026-07-30 |
| D-003 | Harness worktree/isolation artifacts stay under `Harness/`. | User explicitly required this storage boundary. | 2026-07-30 |
| D-004 | Workflow can choose built-in subagents vs `wf-subagents` backed by real terminals. | User wants both mechanisms visible/configurable. | 2026-07-30 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | `Agents` shows only auto-detected terminal agent platforms, supports manual rescan, and launches an interactive observable terminal session without runtime/task fields. | `/api/runtimes` returns detected only; Codex browser smoke created a real PTY session with `@homebridge/node-pty-prebuilt-multiarch`; Agents floating terminal/minimize smoke passed; backend session tests passed. | passed |
| AC-002 | `Workflow` is a responsive Apple-style canvas where nodes are Harness terminal agent instances, supports built-in vs `wf-subagents` selection, default no task binding, optional task binding, and visible edge/status flow. | Workflow browser smoke confirmed header-only full-height route and canvas pan from `translate(0px, 0px)` to `translate(55px, 40px)`; `buildWorkflowSnapshot` tests cover terminal session nodes and `Harness/a2a` unbound sessions. | passed |
| AC-003 | Existing role-oriented display is available from a separate `Roles` route, while terminal-agent config exposes known CLI config locations and editable metadata without guessing unavailable platforms. | Roles route smoke passed; `runtime-config.test.mjs` covers JSON/TOML config writes and backup. | passed |

## Expanded Contracts

- Agent detection: registry of common CLI commands, scan `PATH`, return only installed commands to the UI.
- Terminal sessions: create/attach/resize/input/stop/restart/clear/log support using existing server primitives where available.
- Workflow state: Harness-owned A2A/workflow files under `Harness/`; wf-subagent nodes map to real terminal sessions.
- Config editing: display documented or detected global config paths; writes must be schema-aware or limited to explicit simple fields.

## Subagent Dispatch

| Task | Agent | Mode | Read set | Write set | Dependency | Output | Status |
|------|-------|------|----------|-----------|------------|--------|--------|
| Explore current wf-ui implementation | codebase-explorer | read | `src/ui`, `src/wf-ui-server`, `Harness/a2a` | none | none | route/API map | Done |
| Research CLI command/config paths | docs-researcher | read | official docs/search results | none | none | candidate registry/config notes | Done |
| Plan implementation slices | planner | read | user request, route/API map | none | exploration | writeSet/test plan | Done |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Native PTY behavior differs on Windows. | Added prebuilt PTY optional dependency path; browser smoke created and stopped a real Codex PTY session. Real CLI auth still depends on the local CLI. | mitigated |
| Third-party CLI config schemas differ by version. | Config writes are limited to known simple fields and create backups before overwrite. | mitigated |
