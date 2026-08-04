# Test Plan: {{FEATURE_NAME}}

| AC ID | Test Level | File/Command | Evidence |
| --- | --- | --- | --- |
| AC-001 | wf-browser control run + fallback Playwright/CDP when needed | `Harness/wf-browser/runs/<runId>/...` or `npx playwright test {{SPEC_FILE}} --trace on` | run manifest, action log, screenshot, UI tree, logs, network, trace |

Required checks:

- unit tests for pure logic
- API/integration tests for API contracts
- `wf-browser` control loop for browser-visible paths when the page can load the Harness Bridge
- fallback Playwright/CDP for third-party pages, native browser capabilities, or bridge gaps
- screenshot, UI tree, log, state, network, trace, or video artifact paths for browser validation
- multi-window/subagent lease evidence when validating concurrent UI work
- syntax-only checks, shallow renders, imports, typecheck, lint, and build success do not satisfy browser-visible ACs
