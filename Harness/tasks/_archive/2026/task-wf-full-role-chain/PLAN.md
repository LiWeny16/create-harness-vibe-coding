# task-wf-full-role-chain - PLAN

## Goal

- Outcome: `/wf` defaults to the complete mandatory role chain; `/wf-max` is its strict maximum-parallelism superset; neither can close until cross-review and reflector pass.
- Non-goals: Do not rewrite historical task records.

## Decisions

- User decision: `/wf` starts full role coverage by default, not only three exploration roles.
- User decision: final acceptance requires cross-review approval before verification can close.
- User decision: add a `reflector` agent.
- User decision: `/wf-max` must inherit all `/wf` requirements and maximize subagent fan-out.
- User decision: if one runtime's subagent pool reaches a limit, overflow to the other CLI (`claude -p` or available Codex CLI) before bounded fallback.
- User decision: `/wf-auto` and `/wf-auto-spark` inherit WF gates per accepted cycle; Codex++/forks are experimental, not stable capacity.
- User decision: generated Codex config should default WF-MAX to `agents.max_threads = 12`, keep `max_depth = 1`, and ask before raising the thread cap further.

## Acceptance

- AC-001: Generated scaffold includes `reflector` in the Claude agent roster and validator required files.
- AC-002: `/wf` docs require full plan/research/architecture/test/implement/validation/cross-review/reflect/accept coverage by default.
- AC-003: `/wf-max` docs require WF strict superset behavior plus cross-CLI overflow before fallback.
- AC-004: Closeout requires cross-review pass and reflector PASS before final acceptance.
- AC-005: `/wf-auto` and `/wf-auto-spark` require the full WF chain per accepted cycle.
- AC-006: `/wf-max` records official runtime thread budget rules and rejects undocumented limit bypasses as stable capacity.
- AC-007: Generated scaffold sets Codex `max_threads = 12` and documents user-confirmed escalation when that becomes the bottleneck.

## Scope

Allowed write set:
- `.claude/agents/reflector.md`
- `templates/common/.claude/agents/reflector.md`
- `Harness/WF.md`
- `Harness/WF-MAX.md`
- `Harness/subagents.md`
- `Harness/agent-workflow.md`
- `Harness/dispatch.md`
- `Harness/README.md`
- `Harness/MEMORY.md`
- `templates/common/Harness/WF.md`
- `templates/common/Harness/WF-MAX.md`
- `templates/common/Harness/subagents.md`
- `templates/common/Harness/agent-workflow.md`
- `templates/common/Harness/dispatch.md`
- `templates/common/Harness/README.md`
- `templates/common/MEMORY.md`
- `.codex/config.toml`
- `templates/common/.codex/config.toml`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/scripts/validate-harness.mjs`
- skill adapters and command help
- `tests/generator.test.js`
- `tests/validate-harness.test.js`
- `templates/common/.harness-version`
- `Harness/PROGRESS.md`
- `Harness/tasks/task-wf-full-role-chain/*`

Forbidden:
- Historical task record rewrites

## Context

- Loaded: `wf` skill, `Harness/WF.md`, `Harness/subagents.md`, `Harness/agent-workflow.md`, current reviewer/verifier agents.
- Assumptions: "cross-review" means at least two independent review lenses, then reflector synthesis, before final verifier acceptance.

## Verification

- [x] `node --test tests/generator.test.js tests/validate-harness.test.js`
- [x] `node Harness/scripts/validate-harness.mjs --strict`
- [x] `node tests/e2e-wf-scripts.test.mjs`
- [x] `npm test`
- [x] `node scripts/build-version.mjs --check`
- [x] cross-review PASS

## Risks

- More mandatory roles can slow `/wf`; docs allow bounded-pass fallback only when real subagents/cross-CLI overflow are unavailable.
- `scan-clean` still reports existing optional/browser workflow orphans against this repo's old dogfood `Harness/.harness-version`; generated templates and validators pass.
