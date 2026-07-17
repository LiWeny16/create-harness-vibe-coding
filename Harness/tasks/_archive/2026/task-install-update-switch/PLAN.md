# task-install-update-switch - PLAN

Task-level implementation plan and evidence. Main agent writes after second planning; implementer reads before coding.

## Goal

Align install/update/browser command behavior with the user's decisions: existing Harness installs switch to update, `/wf-browser` remains optional, command tables match installed skills, and WF-MAX D-GATE wording is unambiguous.

## Mini PRD

Scope:
- Change `create-harness-vibe-coding` so a target with existing `Harness/` automatically routes to the target's update checker instead of continuing install writes.
- Keep `/wf-browser` optional: default scaffold docs/help/memory must not advertise it unless `browser-e2e` is selected.
- Add validator coverage so command tables cannot list a skill command without corresponding Claude/Codex skill files.
- Fix WF-MAX D-GATE wording so failure blocks W2 implementation, not W1 architecture.
- Sync common template docs and checksums.

Non-scope:
- Do not change `wf-auto-spark` budget behavior in this task.
- Do not alter `wf-update` conflict/finalize logic from the previous task except through version regeneration.
- Do not install external browser tooling.

User flow:
1. User runs `npx create-harness-vibe-coding ...` against a directory that already has `Harness/`.
2. CLI detects installed Harness and runs `node Harness/scripts/wf-update-check.mjs` in that target.
3. CLI reports update-check output and exits without creating install files.
4. New default scaffolds only show commands that are installed by default.

UI elements:
- None.

API behavior:
- CLI behavior and JSON output only.

## Acceptance Criteria

| AC ID | Given / When / Then | Verification | Evidence |
|-------|----------------------|--------------|----------|
| AC-001 | Given target already has `Harness/`, when install CLI runs non-JSON with `--on-conflict skip`, then it switches to update check and does not create install-only files like `Harness/SETUP.md` or root `CLAUDE.md`. | `node --test tests/cli-smoke.test.js` | RED/GREEN output |
| AC-002 | Given target already has `Harness/`, when install CLI runs `--json --dry-run`, then JSON reports `mode: "update"` with update command guidance and no install write plan. | `node --test tests/cli-smoke.test.js` | RED/GREEN output |
| AC-003 | Given default scaffold generation, when reading README/help/MEMORY, then `/wf-browser` and `browser-e2e` are not advertised unless optional `browser-e2e` is installed. | `node --test tests/generator.test.js tests/cli-smoke.test.js` | RED/GREEN output |
| AC-004 | Given command docs list a skill command, when validator runs, then missing `.claude/skills/<name>` or `.agents/skills/<name>` fails validation. | `node --test tests/validate-harness.test.js` | RED/GREEN output |
| AC-005 | Given WF-MAX D-GATE wording, when generated scaffold is inspected, then D-GATE failure blocks W2 implementation dispatch and does not claim W1 is blocked by D-GATE. | `node --test tests/generator.test.js` | RED/GREEN output |

## UI Contract

| Element | Selector / Role | States | AC IDs |
|---------|-----------------|--------|--------|
| N/A | N/A | N/A | N/A |

## API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|
| CLI: install existing Harness | process args | Runs update checker, no install writes | AC-001 |
| CLI: install existing Harness JSON | process args | JSON object with `mode: "update"`, `agent.next[0].action: "update"` | AC-002 |
| CLI: validator | process args | Fails on command/skill mismatch | AC-004 |

## Test Plan

For browser-visible ACs, include real user actions and evidence. Syntax-only checks, import tests, shallow renders, typecheck, lint, and build success are not acceptance evidence for UI behavior.

| AC ID | Test Level | User Action / API Request | Command / File | Evidence | Status |
|-------|------------|---------------------------|----------------|----------|--------|
| AC-001 | CLI integration | Run install CLI against temp target with existing Harness update script | `tests/cli-smoke.test.js` | RED then GREEN | Passed |
| AC-002 | CLI JSON integration | Run install CLI JSON dry-run against temp target with existing Harness update script | `tests/cli-smoke.test.js` | RED then GREEN | Passed |
| AC-003 | generator integration | Generate default and browser optional projects, inspect docs/skills | `tests/generator.test.js`, `tests/cli-smoke.test.js` | RED then GREEN | Passed |
| AC-004 | validator unit/integration | Delete a command-listed skill from temp generated project and run validator | `tests/validate-harness.test.js` | RED then GREEN | Passed |
| AC-005 | generator doc regression | Inspect WF-MAX generated text | `tests/generator.test.js` | RED then GREEN | Passed |

## Scope

Allowed write set:
- `src/index.js`
- `tests/cli-smoke.test.js`
- `tests/generator.test.js`
- `tests/validate-harness.test.js`
- `Harness/scripts/validate-harness.mjs`
- `templates/common/scripts/validate-harness.mjs`
- `Harness/WF-MAX.md`
- `templates/common/Harness/WF-MAX.md`
- `Harness/README.md`
- `templates/common/Harness/README.md`
- `Harness/MEMORY.md`
- `templates/common/MEMORY.md`
- `.claude/commands/wf-help.md`
- `templates/common/.claude/commands/wf-help.md`
- `templates/common/.harness-version`
- `Harness/tasks/task-install-update-switch/PLAN.md`
- `Harness/tasks/task-install-update-switch/PROGRESS.md`
- `Harness/PROGRESS.md`

Forbidden:
- User project data outside this repo's Harness task capsule
- `wf-auto-spark` behavior changes
- PRD / acceptance criteria / UI contract / API contract / test plan / validation report unless Change Request is recorded

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`
- `Harness/agent-workflow.md`
- `Harness/ACCEPTANCE_PROTOCOL.md`
- `Harness/AGENT_ISOLATION.md`
- `Harness/HARNESS_BRIDGE.md`
- `Harness/TDD-GUIDE.md`
- `.agents/skills/wf/SKILL.md`
- `.agents/skills/tdd/SKILL.md`
- `.agents/skills/subagent-orchestrator/SKILL.md`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| planner | bounded pass fallback | user decisions, existing audit, router docs | none | Done |
| test-writer | bounded pass fallback | AC table, CLI/generator/validator tests | tests only | Pending |
| implementer | serial write lane | failing tests, allowed source/docs | allowed write set | Pending |
| reviewer | bounded pass fallback | diff and verification output | none | Pending |
| verifier | command runner | test commands | none | Pending |

## Subagent Synthesis

Agents used:
- planner bounded pass, test-writer bounded pass, implementer serial write lane, verifier command runner.
Findings accepted:
- Existing Harness install entry should auto-switch to the installed update checker and skip install writes.
- `/wf-browser` should remain optional and only appear in generated docs/help when `browser-e2e` is selected.
- Validator should fail when command docs list a missing Claude/Codex skill.
- WF-MAX D-GATE failure blocks W2 implementation dispatch.
Findings rejected:
- Hard-stopping existing Harness install without update delegation; user explicitly chose auto-switch to update.
- Changing `wf-auto-spark` budgets in this task; user deferred it.
Conflicts:
- None.
Decisions:
- Use target-local `node Harness/scripts/wf-update-check.mjs` as the install-to-update switch.
- JSON install mode returns `mode: "update"` plus parsed update-check output and no install `plan`.
- Dynamic optional registration adds `/wf-browser` rows only when `browser-e2e` is selected.
Residual risk:
- If an old installed Harness lacks `Harness/scripts/wf-update-check.mjs`, install now exits without writing and reports the missing update checker.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| RED targeted tests | PASS | New tests failed before implementation for existing-Harness update switch, default `/wf-browser`, and validator command/skill drift. |
| `node --test tests/cli-smoke.test.js` | PASS | 25 passed, 1 skipped, 0 failed |
| `node --test tests/generator.test.js` | PASS | 32 passed, 0 failed |
| `node --test tests/validate-harness.test.js` | PASS | 9 passed, 0 failed |
| `npm test` | PASS | 68 passed, 1 skipped, 0 failed |
| `node tests/e2e-wf-scripts.test.mjs` | PASS | 161 passed, 0 failed |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Harness validation passed (strict) |
| `node scripts/build-version.mjs --check` | PASS | templates/common/.harness-version already up to date |

## Acceptance Result

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `node --test tests/cli-smoke.test.js` | Existing Harness non-JSON install switches to update checker and creates no install files. |
| AC-002 | PASS | `node --test tests/cli-smoke.test.js` | Existing Harness JSON dry-run returns `mode: "update"` and parsed update output. |
| AC-003 | PASS | `node --test tests/generator.test.js` | Default scaffold omits `/wf-browser`; optional `browser-e2e` generation registers `/wf-browser`. |
| AC-004 | PASS | `node --test tests/validate-harness.test.js` | Validator fails on command docs that list missing Claude/Codex skill files. |
| AC-005 | PASS | `node --test tests/generator.test.js` | WF-MAX generated text blocks W2 implementation dispatch on failing D-GATE. |
