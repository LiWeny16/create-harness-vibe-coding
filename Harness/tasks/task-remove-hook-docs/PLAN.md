# PLAN: Remove WF Hook Docs

## Goal

Honor the explicit hook boundary: the Harness scaffold must not install,
document, validate, or imply broad runtime hooks. The only allowed hook concept
is an optional `/wf-auto` bounded tick hook for long-chain auto mode.

## Non-goals

- Do not weaken acceptance-driven PRD/AC/TDD/E2E requirements.
- Do not remove the Claude/Codex deny list for unsafe tools such as EnterPlanMode.
- Do not add a replacement background daemon or infinite runner.

## Acceptance Criteria

| AC ID | Criteria | Verification |
| --- | --- | --- |
| AC-001 | WF-MAX hook scripts, statusline scripts, hook e2e test, and HOOK_PROTOCOL docs are absent from source and templates. | `Test-Path` checks and validator removed-artifact checks |
| AC-002 | CLAUDE, README, MEMORY, SETUP, agents, and skills no longer claim WF-MAX hook enforcement, hook-managed runtime state, or hook-based memory injection. | `rg` stale-claim search |
| AC-003 | WF-MAX role/writeSet compliance is documented as dispatch discipline plus independent review/validation, not runtime hook enforcement. | Doc inspection and validator required text |
| AC-004 | Memory scenario routing remains available as controller/context guidance without hook triggers. | `MEMORY_PROTOCOL.md` and router docs |
| AC-005 | `/wf-auto` documents the only allowed runtime hook exception: a bounded tick trigger, disabled by default, with stop/pause/A-GATE safeguards. | `WF-AUTO.md` and validator checks |
| AC-006 | Harness validators and tests pass without any broad hook dependency. | `npm test`, `node Harness/scripts/validate-harness.mjs`, strict validation |

## Write Set

- `CLAUDE.md`
- `AGENTS.md`
- `Harness/**`
- `.claude/**`
- `.agents/**`
- `.codex/hooks.json`
- `.claude/settings.json`
- `templates/common/**`
- `tests/**`

## Forbidden

- Reintroducing `wf-mode-hook.mjs`, `wf-statusline.*`, `HOOK_PROTOCOL.md`, or broad hook registration.
- Editing unrelated product source.

## Subagent Dispatch

Runtime subagent tools are not available in this turn. Bounded role fallback:

| Role | Question | Evidence |
| --- | --- | --- |
| Planner | Which hook artifacts and claims remain? | `rg` stale-claim search |
| Implementer | What files need no-hook cleanup? | scoped patches |
| Verifier | Do validator/tests pass without hook dependencies? | command output recorded in PROGRESS |

## Validation Plan

1. Search stale hook terms. PASS: only wf-auto exception, validator guard text, and task evidence remain.
2. Run `npm run build:version`. PASS.
3. Run `node Harness/scripts/validate-harness.mjs`. PASS.
4. Run `node Harness/scripts/validate-harness.mjs --strict`. PASS.
5. Run generated scaffold validation through the npm test suite. PASS: `npm test` passed with 65 passed, 1 skipped.
