# task-harden-wf-max-fanout - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.

## Goal

- Outcome: Make `/wf-max` force an explicit native subagent fan-out attempt, fix OpenCode manager-to-worker fan-out, and document Claude Code, Codex, and OpenCode subagent limits/config.
- Non-goals: Publish a release, change non-WF behavior, or add a new browser/E2E command.

## Decisions

- WF-MAX must never silently run as a solo controller path; it records fan-out attempt, channel, agents, limit/cap facts, and degradation reason.
- Claude Code has separate documented subagent caps for session total, concurrent running subagents, and nested spawn depth; Harness records these as outer ceilings, not permission to exceed WF-MAX task-local caps.
- OpenCode WF-MAX needs `subagent_depth = 2` because the WF-MAX hierarchy uses primary -> manager subagent -> worker subagent.
- OpenCode manager agents need explicit `permission.task` allowlists for the child agents they spawn.
- Codex scaffold must not write scalar `[agents]` capacity caps into `.codex/config.toml`; local codex-cli 0.144.x rejects that shape during TUI `skills/list`, so WF-MAX capacity is managed in the dispatch ledger unless the installed runtime is verified first.

## Acceptance

- AC-001: WF-MAX docs and skill adapters require a native subagent fan-out attempt and recorded degradation before any solo fallback.
- AC-002: OpenCode `/wf-max` wrapper gives direct execution instructions and does not rely only on implicit skill loading.
- AC-003: OpenCode config and manager agents allow WF-MAX manager -> worker fan-out.
- AC-004: Docs summarize current runtime limit/config surfaces for Claude Code, Codex, and OpenCode.
- AC-005: Validator and tests enforce the new contract and Codex compatibility guard.

## Scope

Allowed write set:
- `Harness/specs/workflows/WF-MAX.md`
- `Harness/specs/runtime/subagents.md`
- `Harness/specs/runtime/dispatch.md`
- `.claude/skills/wf-max/SKILL.md`
- `.agents/skills/wf-max/SKILL.md`
- `.opencode/commands/wf-max.md`
- `.opencode/agents/*-manager.md`
- `.codex/config.toml`, `opencode.json`
- template mirrors under `templates/common/**`
- validator and tests
- this task capsule and `Harness/PROGRESS.md`

Forbidden:
- Unrelated workflow semantics.
- Existing task archives.

## Verification

- [x] `node Harness/scripts/validate-harness.mjs`
- [x] `node --test tests\generator.test.js tests\validate-harness.test.js`
- [x] `node scripts/build-version.mjs --check`
- [x] `npm test`
- [x] `node tests/e2e-wf-scripts.test.mjs`
- [x] `codex --strict-config doctor --json` (`config.load` OK)
- [x] `node Harness/scripts/validate-harness.mjs --strict` attempted; blocked only by existing task capsule cap.

## Risks

- OpenCode CLI is not installed on this machine, so OpenCode runtime behavior can only be validated by config/docs/static tests here.
- Strict release validation still requires archiving completed task capsules because the repo currently has 7 outer task capsules and the strict cap is 5.

## Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `Harness/specs/workflows/WF-MAX.md`, `.claude/skills/wf-max/SKILL.md`, validator | WF-MAX now requires a native fan-out attempt and `fanoutAttempted: true` degradation record. |
| AC-002 | PASS | `.claude/commands/wf-max.md`, `.opencode/commands/wf-max.md`, validator mirror checks | OpenCode command body is explicit and mirrors Claude command body; frontmatter pins `agent: build`. |
| AC-003 | PASS | `opencode.json`, `.opencode/agents/*-manager.md`, generator tests | OpenCode has `subagent_depth = 2` and manager `permission.task` allowlists. |
| AC-004 | PASS | `Harness/specs/workflows/WF-MAX.md`, official docs search | Runtime capacity map documents Claude Code session/concurrent/depth caps, Codex concurrent thread config, and OpenCode nesting depth/task permissions. |
| AC-005 | PASS | `node Harness/scripts/validate-harness.mjs`; `node --test tests\generator.test.js tests\validate-harness.test.js`; `node scripts/build-version.mjs --check`; `npm test`; `node tests\e2e-wf-scripts.test.mjs`; `codex --strict-config doctor --json` | Static and generated scaffold coverage updated; Codex config loads. Strict validator has only the existing task-capsule cap blocker. |
