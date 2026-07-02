# TDD Guide — Test-Driven Development in Harness

TDD is NOT optional in Harness. The agent-workflow loop requires a failing test before implementation.
This guide specifies when, how, and what to test.

## When TDD is Mandatory

| Trigger | Action |
|---------|--------|
| New feature | Write failing test first. Implementation MUST NOT start without it. |
| Bug fix | Write failing regression test that reproduces the bug. Fix only after test fails. |
| Refactor | Existing tests MUST be green before refactoring. Keep green throughout. |
| API endpoint | Integration test first (request → expected response). |
| UI component | Visual regression or behavior test first (render → user action → expected state). |
| Database change | Migration test first (apply → verify schema → rollback → verify). |

## TDD Cycle (Red-Green-Refactor)

```
RED:    Write minimal failing test
        → Run test → FAILS (if it passes, test is wrong)
GREEN:  Write minimal code to make test pass
        → Run test → PASSES
        → Run ALL tests → ALL GREEN
IMPROVE: Refactor while keeping green
        → Run ALL tests → ALL GREEN
        → Coverage check (≥80%)
```

## Coverage Requirements (from ECC common/testing.md)

| Layer | Minimum Coverage | Tool |
|-------|-----------------|------|
| Unit tests (functions, utils, hooks) | 80% | Jest, Vitest, Pytest, Go test |
| Integration tests (API, DB) | 80% | Supertest, Pytest, Go test |
| E2E tests (critical flows) | All critical paths | Playwright, Cypress |
| Visual regression (FE) | Hero, forms, modals | Playwright screenshots |

## Test Structure (AAA Pattern)

```typescript
test('describes behavior under test', () => {
  // Arrange — set up test data
  const input = { email: 'test@example.com' };

  // Act — execute the code being tested
  const result = validateEmail(input.email);

  // Assert — verify expected outcome
  expect(result).toBe(true);
});
```

## Test Naming Convention

```
test('<action> <condition> → <expected outcome>')

Examples:
  test('returns 404 when user not found')
  test('throws ValidationError when email is empty')
  test('falls back to cache when database is unavailable')
  test('emits change event when checkbox is clicked')
```

## Per-Stack TDD Setup

### TypeScript/React (Vitest + Testing Library)
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
# test file: src/components/__tests__/Button.test.tsx
```

### Python/FastAPI (Pytest)
```bash
pip install pytest pytest-cov httpx
# test file: tests/test_users_api.py
```

### Go
```bash
# test file: internal/handler/users_test.go (same package, _test suffix)
```

### Rust
```bash
cargo add --dev tokio-test
# test file: tests/integration_test.rs
```

## Agent Dispatch — TDD Gate

Before dispatching an Implementer, the Planner MUST verify:

1. [ ] Test file exists for the target module
2. [ ] Test is RED (fails) for new feature / bug fix
3. [ ] Test covers acceptance criteria
4. [ ] Test covers error paths (not just happy path)
5. [ ] Coverage threshold declared in PLAN.md

If any check fails → dispatch Test Writer first, then Implementer.

## TDD Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|-------------|---------|-----|
| **Test-last** | Writing implementation first, then tests "to verify" | Reverse order. Tests first. |
| **Test-the-test** | Test passes immediately (testing nothing) | Add real assertion. Delete and rewrite. |
| **Giant test** | One test covering entire feature | Split into unit (logic) + integration (API) + E2E (flow) |
| **Mock everything** | All dependencies mocked, no real behavior tested | Mock only external I/O (network, disk). Test real logic. |
| **Skip coverage** | "80% is too hard, let's move on" | Coverage is a gate. Don't merge without it. |

## TDD in WF-MAX Mode

In `/wf-max`, tests and implementation are dispatched in SEPARATE waves.
Test Writers MUST complete before Implementers start. No parallel overlap.

```
W2a — TEST WAVE (Test Writers, parallel):
  1. Test Writer (FE) → write failing tests for UserProfile
  2. Test Writer (BE) → write failing API tests for GET /users
  ↓ BARRIER: all tests written and confirmed RED ↓

W2b — IMPLEMENTATION WAVE (Implementers, parallel):
  3. Implementer (FE) → make FE tests pass
  4. Implementer (BE) → make BE tests pass
  ↓ BARRIER: all tests GREEN ↓

W2R — REVIEW WAVE:
  5. Reviewer → verify test coverage + implementation correctness
```

**Why separate waves:** Workers in the same WF-MAX wave run in parallel.
If Test Writers and Implementers share a wave, Implementers start before RED
tests exist — violating the TDD gate. Two waves with an explicit barrier
ensures tests exist before any implementation begins.

## Verification

After TDD cycle, run the full verification path:

```bash
# Unit + Integration
npm test -- --coverage          # TypeScript
pytest --cov                    # Python
go test -cover ./...            # Go

# E2E (if applicable)
npx playwright test             # Playwright

# Harness validator
node Harness/scripts/validate-harness.mjs --strict
```
