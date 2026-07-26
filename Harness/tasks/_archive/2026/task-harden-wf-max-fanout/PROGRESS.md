# task-harden-wf-max-fanout - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Verified
- Next: User review; optional task archive housekeeping before strict release validation.
- Blocker: OpenCode CLI is not installed locally; strict validator is blocked by existing task capsule cap.

## Tasks

- [x] Define goal and acceptance criteria
- [x] Confirm local OpenCode CLI availability
- [x] Patch WF-MAX runtime docs and skills
- [x] Patch OpenCode command/config/manager permissions
- [x] Patch Codex config field and tests
- [x] Run validation

## Changes

- Found `opencode` is not in PATH locally; `claude` and `codex` are available.
- Found OpenCode docs require `subagent_depth = 2` for subagent -> subagent nesting, while the project had no `subagent_depth`.
- Found Codex docs use `agents.max_concurrent_threads_per_session`, but local codex-cli 0.144.x rejects scalar `[agents]` capacity caps from project `.codex/config.toml`; generated config now avoids them.
- Added `subagent_depth = 2` to OpenCode config and `permission.task` allowlists to WF-MAX manager agents.
- Added mandatory fan-out attempt/degradation recording to WF-MAX docs, skills, and command wrappers.
- Updated Claude Code runtime capacity docs to include session, concurrent, and spawn-depth subagent caps.
- Updated validator/tests and regenerated `.harness-version`/ownership manifests.

## Verification

- PASS: `node Harness/scripts/validate-harness.mjs` (warning only: outer task capsule cap exceeded)
- PASS: `node --test tests\generator.test.js tests\validate-harness.test.js`
- PASS: `node scripts/build-version.mjs --check`
- PASS: `node tests/e2e-wf-scripts.test.mjs`
- PASS: `npm test`
- PASS: `codex --strict-config doctor --json` for `config.load` (`overallStatus: warning` only because of unrelated MCP/terminal/update warnings)
- EXPECTED FAIL: `node Harness/scripts/validate-harness.mjs --strict` because `Harness/tasks/` has 7 outer task capsules (cap 5).
- NOT RUN: OpenCode runtime invocation; `opencode --help` fails because `opencode` is not installed/in PATH on this machine.
