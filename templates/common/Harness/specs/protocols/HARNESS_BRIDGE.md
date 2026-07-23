# Harness Bridge

Purpose: define a test-only bridge for validating frontend, backend, state, and side effects without making test selectors part of production behavior.

Harness Bridge is not a business feature. It is enabled only in dev/test environments and must be absent or inert in production builds.

## Modules

| Module | Purpose | Output |
| --- | --- | --- |
| UI Test ID Contract | stable selectors for browser tests | `UI_CONTRACT.md` or task contract table |
| API Contract | endpoint, payload, response, and failure behavior | `API_CONTRACT.md` or OpenAPI/schema reference |
| Test Data Seeder | deterministic local data and mock external services | seed script or test fixture |
| Runtime State Probe | test-only access to route/store/toast state | `window.__HARNESS__` or equivalent |
| Network Trace Collector | CDP/Playwright capture of request/response behavior | trace file and assertion output |

## UI Test ID Contract

Every critical interactive element needs a stable selector before UI acceptance.

```tsx
<button data-testid="login-submit-button">Log in</button>
```

Contract shape:

```markdown
# UI Contract

| Element | data-testid | Role | AC IDs |
| --- | --- | --- | --- |
| Phone input | `phone-input` | input phone number | AC-001, AC-002 |
| Submit button | `login-submit-button` | submit login | AC-004, AC-006 |
```

No `data-testid`, no UI acceptance, unless a stable accessible role/label is explicitly documented.

## API Contract

API-facing ACs need method, URL, payload, success response, failure response, and side effects.

````markdown
# API Contract

## POST /api/auth/send-code

Request:
```json
{ "phone": "13800138000" }
```

Success:
```json
{ "ok": true }
```

Failure:
```json
{ "ok": false, "message": "Invalid phone number" }
```
````

No API contract, no backend integration acceptance.

## Test Data Seeder

E2E tests must not depend on real SMS, payment providers, emails, or third-party side effects.

Example contract:

```ts
await bridge.seed({
  user: {
    phone: "13800138000",
    code: "123456"
  }
});
```

Seeder requirements:

- deterministic
- resettable between tests
- scoped to dev/test
- records seeded IDs needed for assertions

## Runtime State Probe

Expose only safe test state in dev/test:

```ts
window.__HARNESS__ = {
  getRoute: () => router.currentRoute.value,
  getAuthState: () => authStore.state,
  getLastToast: () => toastStore.lastMessage
};
```

Playwright may assert:

```ts
const authState = await page.evaluate(() => window.__HARNESS__.getAuthState());
expect(authState.isLoggedIn).toBe(true);
```

Production builds must not expose secrets, tokens, private user data, or privileged mutation APIs through `window.__HARNESS__`.

## Network Trace Collector

For frontend-backend ACs, collect network evidence:

```text
user action
-> CDP/Playwright records request
-> assert URL, method, payload, response, duplicate-request behavior
-> compare against API Contract
```

Minimum checks:

- request sent or intentionally not sent
- method and URL
- payload shape and key values
- response handling
- disabled/loading behavior prevents duplicate submission
- error state for network failure

Trace evidence belongs under the task evidence folder or Playwright `test-results/`.
