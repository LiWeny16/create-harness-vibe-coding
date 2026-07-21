# Test Plan: {{FEATURE_NAME}}

| AC ID | Test Level | File/Command | Evidence |
| --- | --- | --- | --- |
| AC-001 | Playwright + CDP | `npx playwright test {{SPEC_FILE}} --trace on` | trace + screenshot |

Required checks:

- unit tests for pure logic
- API/integration tests for API contracts
- Playwright for user-visible paths
- CDP/network assertions for frontend-backend side effects
- screenshot/trace/video on browser validation failure
- syntax-only checks, shallow renders, imports, typecheck, lint, and build success do not satisfy browser-visible ACs
