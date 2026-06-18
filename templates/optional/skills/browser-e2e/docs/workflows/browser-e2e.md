# Browser E2E Workflow

## Required Evidence

- App start command and URL.
- Real-browser load of the changed app before any web/UI acceptance claim.
- Console, runtime, and network check result, including whether React/Vite/client startup errors or failed requests appeared.
- Stable accessible labels/roles and stable test hooks such as `data-testid` are required for critical UI controls and states: inputs, buttons, filters, rows, empty/error/loading states.
- CDP, Playwright, and manual verification must target those selectors for the critical interaction path instead of brittle DOM paths.
- Viewports and browsers checked.
- Screenshot, trace, video, or documented manual screenshot artifact for each critical UI flow.
- Final pass/fail result with exact command output summary.

## Chrome DevTools / CDP / MCP Checklist

- Start the app with the project command and record the URL and port.
- Open a real browser target through available CDP, MCP, browser automation, or manual tooling.
- Wait for a stable app selector, route, or page-ready state, not just HTTP 200.
- Capture runtime exceptions, console errors, and failed network requests before and after the flow.
- Interact through stable accessible labels/roles or `data-testid`, not brittle DOM paths.
- Verify at least one critical flow end-to-end in the real browser target.
- Save screenshot, trace, video, or result artifact paths and record them in `docs/harness/PLAN.md` or the feature doc.
- Clean up any dev server or browser processes started for verification.

## Common Commands

```powershell
npm run dev
npx playwright test
npx playwright test --headed
npx playwright show-report
```

If Playwright is not installed, prefer an existing browser test command from `package.json`. Chrome DevTools/CDP, manual screenshot evidence, or framework-specific tools are acceptable when the method, URL, flow, console/runtime/network result, and artifacts are documented.

## Fallback

When no browser automation is available, run the app locally in a real browser, inspect critical flows manually, capture screenshots, and report console or network errors. Do not claim web/UI acceptance from typecheck, build, or unit tests alone. Do not install new dependencies unless the user approves.

## Windows Notes

Use PowerShell syntax for environment variables, for example `$env:PORT='3000'; npm run dev`. Quote paths that contain spaces.
