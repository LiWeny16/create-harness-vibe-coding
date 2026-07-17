# task-wf-update-finalize-cleanup - PLAN

Task-level implementation plan and evidence. Main agent writes after second planning; implementer reads before coding.

## Goal

Make `wf-update` meet the same operating principle as install/remove: script handles mechanical missing/extra/metadata changes, and AI only handles true semantic merge conflicts.

## Mini PRD

Scope:
- Upgrade `wf-update-check.mjs` so byte-matching existing remote files are adopted without AI conflict.
- Add script-owned conflict decisions/finalization so AI does not hand-edit `Harness/.harness-version`.
- Align cleanup scope with install/remove by scanning framework discovery directories, including `.claude/commands`.
- Audit the rest of the Harness command surface against speed, stability, and effect.
- Sync generated template scripts and update tests.

Non-scope:
- Do not change user-data preserve policy.
- Do not make strict placeholder validation the update success gate.
- Do not auto-delete orphan/custom user files.

User flow:
1. Agent runs `node Harness/scripts/wf-update-check.mjs --json`.
2. Agent runs the safe apply command for mechanical updates.
3. Agent compares only `agent.aiMergeRequired` files and applies decisions through script flags.
4. Agent finalizes through the script; version metadata reaches a clean state when conflicts are resolved or accepted.
5. Agent runs validator and scan-clean.

UI elements:
- None.

API behavior:
- CLI scripts only.

## Acceptance Criteria

| AC ID | Given / When / Then | Verification | Evidence |
|-------|----------------------|--------------|----------|
| AC-001 | Given a new remote file already exists locally with the same remote bytes, when `wf-update-check --json` runs, then it is not listed as AI conflict and can be adopted by script metadata. | `node tests/e2e-wf-scripts.test.mjs` | RED/GREEN command output |
| AC-002 | Given a partial update with a project-specific merge file intentionally kept local, when the agent records an `--accept-local` decision and finalizes, then `.harness-version` has the target generator and no `partialUpdate` conflict residue. | `node tests/e2e-wf-scripts.test.mjs` | RED/GREEN command output |
| AC-003 | Given a dead tracked file under `.claude/commands`, when `scan-clean --json` runs, then it reports the dead file in cleanup scope. | `node tests/e2e-wf-scripts.test.mjs` | RED/GREEN command output |
| AC-004 | Given generated scaffold templates, when package tests run, then runtime and template scripts stay mirrored and validators pass. | `npm test` | Full command output |
| AC-005 | Given the full Harness command set excluding `wf-update`, when read-only subagents audit the surface, then findings are grouped by stability, speed, and effect with concrete improvement candidates. | Subagent reports plus synthesized table | PLAN/PROGRESS and final report |

## UI Contract

| Element | Selector / Role | States | AC IDs |
|---------|-----------------|--------|--------|
| N/A | N/A | N/A | N/A |

## API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|
| CLI: `wf-update-check.mjs --json` | process args | JSON plan with mechanical actions separated from `agent.aiMergeRequired` | AC-001 |
| CLI: `wf-update-check.mjs --apply-safe` | process args | Writes SAFE/NEW/adopted files and records partial metadata if conflicts remain | AC-001 |
| CLI: `wf-update-check.mjs --accept-local <file> --finalize` | process args | Records approved local decision and clears `partialUpdate` when no unresolved conflicts remain | AC-002 |
| CLI: `scan-clean.mjs --json` | process args | Reports dead and orphan files in framework-managed dirs | AC-003 |

## Test Plan

For browser-visible ACs, include real user actions and evidence. Syntax-only checks, import tests, shallow renders, typecheck, lint, and build success are not acceptance evidence for UI behavior.

| AC ID | Test Level | User Action / API Request | Command / File | Evidence | Status |
|-------|------------|---------------------------|----------------|----------|--------|
| AC-001 | integration CLI | Run local remote update JSON and apply-safe | `node tests/e2e-wf-scripts.test.mjs` | expected failing assertion before implementation | Pending |
| AC-002 | integration CLI | Accept local conflict and finalize | `node tests/e2e-wf-scripts.test.mjs` | expected failing assertion before implementation | Pending |
| AC-003 | integration CLI | Run scan-clean JSON against local remote state | `node tests/e2e-wf-scripts.test.mjs` | expected failing assertion before implementation | Pending |
| AC-004 | package suite | Run all tests | `npm test` | final command output | Pending |
| AC-005 | read-only audit | Parallel explorer review of command families | subagent report synthesis | final command audit table | Pending |

## Scope

Allowed write set:
- `Harness/scripts/wf-update-check.mjs`
- `Harness/scripts/scan-clean.mjs`
- `templates/common/scripts/wf-update-check.mjs`
- `templates/common/scripts/scan-clean.mjs`
- `.agents/skills/wf-update/SKILL.md`
- `.claude/skills/wf-update/SKILL.md`
- `templates/common/.claude/skills/wf-update/SKILL.md`
- `templates/common/.harness-version`
- `tests/e2e-wf-scripts.test.mjs`
- `Harness/tasks/task-wf-update-finalize-cleanup/PLAN.md`
- `Harness/tasks/task-wf-update-finalize-cleanup/PROGRESS.md`
- `Harness/PROGRESS.md`

Forbidden:
- User project data outside the task capsule
- PRD / acceptance criteria / UI contract / API contract / test plan / validation report unless Change Request is recorded

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `Harness/subagents.md`
- `Harness/ACCEPTANCE_PROTOCOL.md`
- `Harness/HARNESS_BRIDGE.md`
- `Harness/AGENT_ISOLATION.md`
- `Harness/TDD-GUIDE.md`
- `Harness/scripts/wf-update-check.mjs`
- `Harness/scripts/scan-clean.mjs`
- `Harness/scripts/wf-remove.mjs`
- `tests/e2e-wf-scripts.test.mjs`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| planner | bounded pass fallback | user request, current update/remove/install contracts | none | Done |
| architect | bounded pass fallback | update/remove/scan scripts and metadata model | none | Done |
| test-writer | bounded pass fallback | acceptance criteria and e2e script tests | tests only | In progress |
| install-generator-auditor | explorer subagent | `src/`, `bin/`, `README*`, install tests, templates setup | none | Done |
| remove-clean-auditor | explorer subagent | `Harness/scripts/wf-remove.mjs`, `Harness/scripts/scan-clean.mjs`, remove tests, remove skill | none | Done |
| workflow-command-auditor | explorer subagent | `wf`, `wf-max`, `wf-review`, `wf-readme`, `wf-learn`, `wf-help` docs/skills | none | Done |
| auto-tdd-optional-auditor | explorer subagent | `wf-auto*`, `tdd`, optional workflows, validator coverage | none | Done |
| implementer | serial write lane | tests and update scripts | allowed write set | Pending |
| reviewer | bounded pass fallback | diff and evidence | none | Pending |
| verifier | command runner | verification commands | none | Pending |

## Subagent Synthesis

Agents used:
- `install-generator-auditor` explorer: install/generator safe-merge command audit.
- `remove-clean-auditor` explorer: remove/cleanup command audit.
- `workflow-command-auditor` explorer: WF command adapter/direct command audit.
- `auto-tdd-optional-auditor` explorer: wf-auto/TDD/optional workflow audit.

Findings accepted:
- Update must mirror install/remove separation: scripts own mechanical writes, AI owns semantic merges only.
- `.harness-version` decisions must be written by script flags, not manual JSON edits.
- `scan-clean` must include all framework discovery directories used by remove/install.
- Install/generator command surface is PARTIAL: strong dry-run JSON and safe merge, but needs a hard installed-Harness stop, transactional writes, and deeper scan inventory.
- `wf-remove` is close to PASS, but `scan-clean` was PARTIAL because it missed `.claude/commands`, lacked source-base parity, and did not report residual status richly enough.
- Workflow commands are PARTIAL: strong gates, but WF-MAX D-GATE ordering, durable peer-review/readme evidence, and load breadth need tightening.
- TDD/Acceptance/Bridge are strong; `wf-auto` adapter/spec mismatch, `wf-auto-spark` budget risk, and missing guardrail tests remain.

Findings rejected:
- Full template overwrite of project-specific `CLAUDE.md`; this violates preserve/merge policy.
- Treating strict unresolved project placeholders as update failure.

Conflicts:
- None.

Decisions:
- Add script-level accepted-decision metadata and finalization.
- Add adopted/metadata-only classification for byte-matching existing remote files.
- Keep orphan files report-only; auto-clean only DEAD tracked framework files.
- Treat non-strict validator as the update gate; strict validator is a bootstrap/release debt check.

Residual risk:
- The finalize command must be conservative: it should not clear partial state if unresolved conflicts remain.
- Broader command audit found follow-up work outside this patch: installed-Harness hard stop, WF-MAX D-GATE wording, wf-auto budget consistency, and stronger guardrail tests.

## Command Audit Summary

| Command Family | Verdict | Stability | Speed | Effect | Key Gap |
|----------------|---------|-----------|-------|--------|---------|
| Install/generator | PARTIAL | Good conflict preservation, but write path is not transactional | Fast JSON dry-run and skip path | Effective scaffold creation | Existing `Harness/` should hard-stop noninteractive writes unless explicitly overridden |
| `wf-update` | Improved in this task | Script-owned metadata decisions and finalize added | AI now sees only true conflicts | Clears partialUpdate after accepted decisions | More residual JSON richness can be added later |
| `wf-remove` | NEAR PASS | Strong SAFE/MODIFIED/USER/PURGE split | Fast noninteractive safe removal | Effective removal and purge | JSON should include richer residual folder status |
| `scan-clean` | Improved in this task | Source-base parity and `.claude/commands` scope added | JSON scan is cheap | Finds command orphans now | Orphans remain report-only by design |
| WF commands | PARTIAL | Strong gates and write boundaries | Some load sets broad | Durable task flow works | WF-MAX D-GATE order and durable `/wf-review` evidence need tightening |
| `wf-auto` / `wf-auto-spark` | PARTIAL | TDD/AC strong, auto modes weaker | Spark can run too broadly | Useful evidence loop | Need hard budgets and adapter/spec alignment |
| TDD / Acceptance / Bridge | PASS | Strong anti-syntax-only guardrails | Focused docs | Measurable AC evidence | Add more regression tests for guardrails |

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| RED targeted e2e | PASS | `node tests/e2e-wf-scripts.test.mjs` failed 7 expected assertions before implementation |
| GREEN targeted e2e | PASS | `node tests/e2e-wf-scripts.test.mjs`: 161 passed, 0 failed |
| `npm test` | PASS | 65 passed, 1 skipped, 0 failed |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Harness validation passed (strict) |
| `node scripts/build-version.mjs --check` | PASS | templates/common/.harness-version already up to date |

## Acceptance Result

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
| AC-001 | PASS | `node tests/e2e-wf-scripts.test.mjs` | Byte-matching new remote file is adopted without AI conflict and checksum is recorded by `--apply-safe`. |
| AC-002 | PASS | `node tests/e2e-wf-scripts.test.mjs` | `--accept-local Harness/README.md --finalize` preserves local file, bumps target generator, and clears `partialUpdate`. |
| AC-003 | PASS | `node tests/e2e-wf-scripts.test.mjs` | `scan-clean --json` reports `.claude/commands/legacy.md` orphan with local source-base. |
| AC-004 | PASS | `npm test`; `node scripts/build-version.mjs --check` | Runtime/template scripts and checksums are synced. |
| AC-005 | PASS | Four explorer reports synthesized above | Full command audit completed with stability/speed/effect findings. |
