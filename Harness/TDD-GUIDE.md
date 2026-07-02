# TDD Guide - Test-Driven Development in Harness

TDD is NOT optional in Harness. The workflow loop requires failing executable tests before implementation.
For behavior changes, tests must be derived from PRD acceptance criteria, not from the implementation.

## Source Of Truth

The source of truth for tests is the PRD-derived Acceptance Criteria in `ACCEPTANCE_PROTOCOL.md`.

Required trace:

```text
Mini PRD -> AC ID -> UI/API/state contract -> RED test -> implementation -> validation evidence
```

Every behavior test must reference an AC ID in the test name, test comment, or validation matrix. A test that cannot be traced to an AC ID is not an acceptance test.

## When TDD Is Mandatory

| Trigger | Action |
| --- | --- |
| New feature | Write failing AC-linked test first. Implementation MUST NOT start without it. |
| Bug fix | Write failing regression test that reproduces the bug and links to the affected AC or incident. |
| Refactor | Existing tests MUST be green before refactoring. Keep green throughout. |
| API endpoint | Integration/API contract test first: request -> expected response -> error response. |
| UI component | Behavior test first: real user action -> DOM/state/API result. |
| Browser-visible flow | Playwright/CDP or documented real-browser test first; unit tests are supporting checks only. |
| Database change | Migration test first: apply -> verify schema/data -> rollback -> verify. |

## TDD Cycle

```text
RED:
  Write the smallest AC-linked failing test.
  Run it and confirm it fails for the expected product reason.

GREEN:
  Write the smallest implementation needed to pass.
  Run the target test and confirm it passes.
  Run the declared broader test set.

IMPROVE:
  Refactor while keeping tests green.
  Re-run the declared verification commands.
  Record coverage and acceptance evidence.
```

If the RED test passes immediately, the test is wrong, the fixture is wrong, or the behavior already exists. Stop and record which case is true before implementation.

## Browser/UI Acceptance TDD Gate

For user-visible or browser-visible behavior, syntax checks, type checks, shallow renders, import tests, and assertion-only unit tests are not acceptance tests.

The first acceptance test for a UI flow must exercise the real user path:

1. Open the real route/page in a browser-capable runner.
2. Interact through stable selectors such as `data-testid` or accessible roles.
3. Click, type, select, drag, submit, or navigate as a user would.
4. Assert the DOM result and the relevant URL, route, store, localStorage, or runtime state change.
5. For frontend-backend behavior, assert network/API behavior with Playwright request capture, CDP, or the Harness Bridge Network Trace Collector.
6. Capture evidence: screenshot, trace, video, console log, network log, or validation report path.
7. Record the AC-by-AC result matrix.

Default frontend verification, when tooling exists:

```bash
npm run test
npm run typecheck
npm run lint
npx playwright test
```

For frontend-backend flows or suspected flakes:

```bash
npx playwright test --trace on
```

`npm test`, typecheck, lint, and component-unit tests are useful supporting checks. They cannot replace Playwright/CDP or documented real-browser validation for a browser-visible AC.

## Contract Requirements

Before writing browser or API acceptance tests, load the relevant contracts:

- UI selectors from `UI_CONTRACT.md` or the task PLAN contract table
- API requests/responses from `API_CONTRACT.md` or the task PLAN contract table
- Harness Bridge rules from `HARNESS_BRIDGE.md`
- Agent isolation rules from `AGENT_ISOLATION.md`

Missing selectors or contracts are blockers. Do not silently invent selectors in tests without updating the UI contract through the proper planning/acceptance role.

## ECC Testing Rules

Coverage thresholds, AAA structure, test naming, and per-stack setup live in ECC testing rules (`common/testing.md` plus stack-specific files). This guide defines Harness sequencing and acceptance depth: failing test first, implementation second, real behavior validation last.

## Agent Dispatch - TDD Gate

Before dispatching an Implementer, the Planner or Test Manager MUST verify:

1. [ ] Each behavior change has a Mini PRD or task PLAN entry.
2. [ ] Each behavior change has AC IDs.
3. [ ] Test files or test specs reference the relevant AC IDs.
4. [ ] Tests are RED for new feature / bug fix work and fail for the expected reason.
5. [ ] Tests cover happy path, error path, empty/loading/disabled states where applicable.
6. [ ] Browser-visible ACs have real user interaction tests, not syntax-only or shallow render tests.
7. [ ] Frontend-backend ACs include network/API assertions against the contract.
8. [ ] Evidence capture is declared: screenshot, trace, video, log, or report path.
9. [ ] Coverage threshold and verification commands are declared in PLAN.md.

If any check fails, dispatch Test Writer or Acceptance Agent first, then Implementer.

## Forbidden Shortcuts

These are not valid acceptance tests for browser-visible behavior:

- A test that only imports a component and asserts it renders.
- A test that only checks TypeScript, lint, formatting, or build success.
- A snapshot with no user action and no AC-linked assertion.
- A mocked path where the browser, router, store, API boundary, and side effects are all replaced.
- An assertion against implementation internals instead of user-observable behavior.
- A test written from the implementer's code rather than from PRD/AC/contracts.
- Changing PRD, AC, UI contract, or API contract to make implementation tests pass.

## TDD Anti-Patterns

| Anti-Pattern | Symptom | Fix |
| --- | --- | --- |
| Test-last | Writing implementation first, then tests "to verify" | Reverse order. Tests first. |
| Test-the-test | Test passes immediately and proves no product behavior | Rewrite around the AC and expected RED reason. |
| Syntax-only acceptance | UI flow "tested" by typecheck/build/import assertions | Add Playwright/CDP real user path coverage. |
| Mocked browser path | All browser, state, and network behavior mocked away | Keep only external services mocked; exercise real page behavior. |
| Network-blind UI test | UI assertion passes but request URL/method/payload is unchecked | Add Playwright/CDP/Harness Bridge network assertions. |
| No AC ID | Test name does not map to acceptance criteria | Add AC ID in name/comment and validation matrix. |
| Giant test | One test covering entire feature | Split into unit, API/integration, and E2E acceptance checks. |
| Mock everything | All dependencies mocked, no real behavior tested | Mock only external I/O when needed. Test real logic and boundaries. |
| Skip coverage | Coverage gate ignored | Record configured threshold and command evidence before closeout. |

## TDD In WF-MAX Mode

In `/wf-max`, acceptance/test planning and implementation are separate waves.
Test Writers MUST complete before Implementers start. No parallel overlap.

```text
W2a - ACCEPTANCE/TEST WAVE:
  1. Acceptance Agent -> confirm AC IDs and contracts
  2. Test Writer (FE) -> write RED Playwright/user-path tests for UI ACs
  3. Test Writer (BE) -> write RED API/integration tests for API ACs
  4. CDP/Network Agent -> define request/response assertions
  -> BARRIER: all AC-linked tests written and confirmed RED

W2b - IMPLEMENTATION WAVE:
  5. Implementer (FE) -> make FE acceptance tests pass
  6. Implementer (BE) -> make API tests pass
  -> BARRIER: target tests GREEN and broader checks run

W2R - REVIEW/VALIDATION WAVE:
  7. Reviewer -> verify diff, AC coverage, and forbidden-file discipline
  8. Validator -> run real browser/API validation and produce AC matrix
```

Workers in the same WF-MAX wave run in parallel. If Test Writers and Implementers share a wave, Implementers can start before RED tests exist, violating the TDD gate.

## Verification

Run the verification commands declared in the task PLAN or dispatch packet. Do not claim TDD completion until RED, GREEN, full-check evidence, and AC-by-AC validation evidence are recorded.
