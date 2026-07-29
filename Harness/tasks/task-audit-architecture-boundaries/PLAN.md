# task-audit-architecture-boundaries - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

> Task ID: task-audit-architecture-boundaries

## Goal

- Outcome: Audit the current project architecture with focus on startup routing, task state, skill dispatch, and safety boundaries; return major risks, evidence locations, and improvement priority.
- Non-goals: Do not change production/source behavior. Do not rewrite Harness architecture. Do not archive unrelated tasks.

## Decisions

- Use WF-Standard because the audit spans multiple Harness/runtime areas and requires one independent review lens.
- Use read-only source exploration and review. Write set is limited to this task capsule and global active-task bookkeeping.
- Memory preflight found no route requiring detailed `Harness/memory/*` loads.

## Acceptance

- AC-001: Startup routing risks are identified with file/line evidence.
- AC-002: Task state/resume risks are identified with file/line evidence.
- AC-003: Skill dispatch and safety-boundary risks are identified with file/line evidence and prioritized fixes.

## Scope

Allowed write set:
- `Harness/tasks/task-audit-architecture-boundaries/PLAN.md`
- `Harness/tasks/task-audit-architecture-boundaries/PROGRESS.md`
- `Harness/tasks/task-audit-architecture-boundaries/STATE.json`
- `Harness/PROGRESS.md`
- existing task `STATE.json` files only if `Harness/scripts/task-state.mjs set-active` normalizes active-task consistency

Forbidden:
- production/source files
- template source rewrites
- `Harness/memory/*`
- task archive/move operations
- Truth files (PRD, ACs, UI/API contracts, test plan, validation report) unless a Change Request is recorded.

## Memory Preflight

- Memory preflight: done
- Memory hints: none

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md` index, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/runtime/subagents.md`, `Harness/specs/runtime/dispatch.md`, `Harness/specs/runtime/agent-workflow.md`, `Harness/specs/runtime/context-loading.md`, `Harness/specs/protocols/AGENT_ISOLATION.md`
- Assumptions: The audit should be evidence-first and read-only except WF task state.

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|
| controller | read routed Harness docs; write task capsule | Integrated findings |
| codebase-explorer | read startup routing, task state, skill dispatch files; write none | Returned: state validation gap, routing drift, safety-boundary evidence |
| reviewer | read audit evidence and safety boundary files; write none | Returned: read-only tool boundary gap, dispatch schema gap, acceptance-rule conflict |

## Subagent Dispatch

| Task | Agent | Mode | Read set | Write set | Dependency | Output | Status |
|------|-------|------|----------|-----------|------------|--------|--------|
| D1 startup/state/skill architecture scan | codebase-explorer | Read | `CLAUDE.md`, `AGENTS.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/**`, `.agents/skills/**/SKILL.md`, `.claude/agents/*.md`, scripts referenced by routing/state | none | none | evidence map and risk candidates | Returned |
| D2 safety-boundary independent review | reviewer | Read | user request, task PLAN/PROGRESS, D1 evidence, safety docs/scripts/rules | none | D1 or controller evidence | severity-ranked review findings | Returned |

## Review Synthesis

Agents used:
- controller, codebase-explorer, reviewer

Findings accepted:
- P0: `STATE.json` is the documented resume truth, but validators only enforce a small subset of fields. Dispatch ledger, mode, tier, gate, and queue item schema can drift while validation passes.
- P0: read-only role boundaries are mostly prompt/procedure controls. Reviewer/verifier roles declare read-only behavior but still expose broad Bash in Claude agent metadata.
- P1: WF startup routing and skill trigger language drift across `CLAUDE.md`, `Harness/README.md`, command wrappers, and skill frontmatter. This can route ordinary "review" or bare "wf" phrasing differently by runtime.
- P1: tier-aware acceptance is contradicted by stricter generic subagent closeout text. WF-Standard requires one review lens, while subagent docs still imply cross-review plus reflector for all implementation closeouts.
- P2: safety around update/remove/archive is materially stronger than workflow-role safety because scripts enforce preserve lists, path normalization, checksum checks, and dry-run/archive rules.
- P2: empty retired `browser-e2e` skill directories remain in `.claude/skills` and `.agents/skills`; no `SKILL.md` exists and generated-output tests prevent creating that skill, so this is cleanup/validator hygiene.

Findings rejected:
- Treating root/template drift as a current core risk. Core startup/state/safety files checked in root match `templates/common/**`; Codex skill mirrors are generated from `.claude/skills` by `createCodexSkillMirrors()` and covered by tests.

Conflicts:
- `WF-STATE.md` uses lowercase `tier` and queue item status enums, while `dispatch.md` documents title-case dispatch statuses. Normalize to one machine schema before expanding validator strictness.

Decisions:
- Close this as an architecture audit, not a fix pass.
- Restore the previous active task pointer after closeout so resume continues `task-release-stable-github`.

Next write set:
- none for source. Future fix task should touch `templates/common/**`, generated root mirrors, validators, and tests together.

Verification path:
- `node Harness/scripts/task-state.mjs validate --json`
- `node Harness/scripts/validate-harness.mjs`

Acceptance/contract traceability:
- AC-001 covered by routing evidence.
- AC-002 covered by state/resume evidence.
- AC-003 covered by skill dispatch and safety-boundary evidence.

Residual risk:
- Non-archived task count remains above cap until completed tasks are archived with maintainer approval.

## Verification

- [ ] `node Harness/scripts/task-state.mjs validate --json`
- [ ] `node Harness/scripts/validate-harness.mjs`

## Risks

- Existing unrelated active task needs restoration after this audit: `task-release-stable-github`.
- `Harness/tasks/` exceeds the non-archived cap after adding this audit task; do not archive without explicit request.
- Workflow role boundaries are not uniformly runtime-enforced; validators should distinguish documented constraints from executable controls.

## Expanded Contracts

N/A for read-only architecture audit.
