# Acceptance Protocol

Purpose: make the Harness workflow acceptance-driven instead of implementation-driven.

The source of truth is not the implementation, not the tests, and not the agent's summary. The source of truth is the PRD-derived Acceptance Criteria. Implementation, tests, reviews, validation, debugging, and memory must all trace back to Acceptance Criteria IDs.

## Mother Flow

All Harness modes use the same product-to-proof flow:

```text
Context Load
-> Mini PRD
-> Acceptance Criteria
-> UI/API Contracts
-> Test Plan
-> Implementation Dispatch
-> Independent Validation
-> Cross-Review
-> Reflector PASS
-> Final Acceptance
-> Debug/iterate if needed
-> Memory
```

Mode differences are organizational only:

| Mode | Organization | Same Acceptance Flow |
| --- | --- | --- |
| `/wf` / `$wf` | Complete role chain | yes |
| `/wf-max` / `$wf-max` | Complete role chain plus CEO -> Manager -> Worker fan-out | yes |
| `/wf-auto` / `$wf-auto` | Repeating optimization loop | yes, per cycle |

## Gates

These gates apply before implementation unless the user explicitly asks for a small fast lane. A fast lane may compress artifacts into one task PLAN, but it must not skip the substance.

| Gate | Rule | Required Durable Artifact |
| --- | --- | --- |
| PRD-GATE | No PRD, no implementation. | `Harness/research/PRD.md` or task PLAN Mini PRD |
| AC-GATE | No acceptance criteria, no tests, no code. | `ACCEPTANCE.md` section or task PLAN AC table |
| CONTRACT-GATE | No UI/API contract, no UI/API integration. | `UI_CONTRACT.md`, `API_CONTRACT.md`, or task PLAN contract tables |
| TEST-GATE | Tests must trace to AC IDs before implementation. | `TEST_PLAN.md` section or task PLAN verification matrix |
| IMPLEMENT-GATE | Implementer may not modify acceptance truth files except through Change Request. | dispatch write set and forbidden set |
| VALIDATION-GATE | Validator must be independent and must validate AC IDs against running behavior. | validation report with evidence matrix |
| REVIEW-GATE | Reviewer reads PRD, AC, diff, and run evidence directly. | findings with AC IDs |
| REFLECT-GATE | Reflector reads verifier evidence and reviewer findings before final acceptance. | PASS, RETURN_TO_DEBUG, or BLOCKED verdict |

Truth files are:

- PRD or Mini PRD
- Acceptance Criteria
- UI Contract
- API Contract
- Test Plan
- Validation Report

## Mini PRD Minimum

Every task that changes behavior needs a Mini PRD. It can live in `Harness/research/PRD.md`, a feature doc, or `Harness/tasks/<task-id>/PLAN.md`.
For routine scoped work, keep the Mini PRD compact. Do not expand into a long
product brief unless scope, risk, or user-facing behavior requires it.

Minimum fields:

- Goal
- Scope
- Non-scope
- User flow
- UI elements, if any
- API behavior, if any
- State changes
- Acceptance criteria
- Verification commands

## Acceptance Criteria Format

Each AC must be independently testable and use a stable ID:
Default to 1-3 concise ACs in the task PLAN. Expand to full UI/API contracts,
test plan, and AC-by-AC validation matrix only for browser-visible,
API/integration, security/data-loss, cross-module, or other high-risk behavior.

```markdown
## AC-001: Empty phone number cannot request verification code
Given the user opens the login page
When the user clicks "Get code" without entering a phone number
Then the page shows "Please enter phone number"
And no `/api/auth/send-code` request is sent

Verification:
- UI: Playwright clicks `[data-testid=get-code-button]`
- DOM: expect `[data-testid=phone-error]` visible
- Network: CDP trace has no `/api/auth/send-code` request
```

Required fields:

| Field | Description |
| --- | --- |
| AC ID | Stable unique ID, e.g. `AC-001` |
| Scenario | Given / When / Then user behavior |
| UI elements | Required `data-testid` values or accessible roles |
| API behavior | Method, URL, payload, response, and whether a request must or must not happen |
| State change | URL, DOM, store, localStorage, database, or side effect |
| Verification method | Unit, integration, API, Playwright, CDP, visual, or manual |
| Evidence | Screenshot, trace, video, log, or command output path |

## Role Ownership

| Role | Owns | Must Not Do |
| --- | --- | --- |
| Planner | Mini PRD, scope, non-scope, risks | write implementation |
| Acceptance Agent | AC IDs from PRD and user scenarios | read implementation code to reverse-engineer tests |
| Contract Agent | UI/API/state contracts | loosen contracts to match existing code |
| Test Writer | executable tests from AC/contracts | write tests from implementation behavior |
| Implementer | code/docs inside dispatch write set | modify truth files to make code pass |
| Reviewer | diff review against PRD/AC/contracts/evidence | rely only on implementer summary |
| Validator | running app/API evidence matrix | validate own implementation |
| Debugger | root cause and smallest fix for reproduced failures | blind-edit without locating the failing layer |
| Memory Master | durable lessons keyed to AC/failure patterns | store secrets or noisy transcript summaries |

See `AGENT_ISOLATION.md` for context and permission isolation.

## Test Strategy

Tests must be chosen by risk and user-visible behavior:

Syntax-only checks, import tests, shallow renders, typecheck, lint, and build success are never sufficient acceptance evidence for browser-visible behavior. A browser-visible AC requires a real user path through Playwright/CDP, Browser Use, or documented manual browser validation.

| Behavior | Default Verification |
| --- | --- |
| Pure logic | unit test with AC ID in test name/comment |
| API behavior | API/integration test against contract |
| UI interaction | Playwright real-browser test |
| Frontend-backend side effect | Playwright plus CDP/network trace |
| Visual layout risk | screenshot or visual regression evidence |
| Third-party dependency | seeded/mocked test data plus fallback-path check |

Frontend default verification, when available:

```bash
npm run test
npm run typecheck
npm run lint
npx playwright test
```

For complex frontend-backend flows:

```bash
npx playwright test --trace on
```

## Acceptance Result Matrix

Validation must end with a matrix, not a generic "all tests passed" claim:

```markdown
# Acceptance Result

| AC ID | Result | Evidence | Notes |
| --- | --- | --- | --- |
| AC-001 | PASS | `test-results/login-empty-phone/trace.zip` | no API request observed |
| AC-002 | FAIL | `test-results/login-bad-phone/screenshot.png` | error message missing |
```

Result values: `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `N/A`.

## Change Request

If implementation shows an AC or contract is wrong:

1. Stop implementation.
2. Record the mismatch in task `PROGRESS.md`.
3. Update PRD/AC/contract through Planner or Acceptance role.
4. Re-run TEST-GATE before implementation resumes.

The implementer may propose a Change Request, but may not directly rewrite truth files inside the implementation write set.
