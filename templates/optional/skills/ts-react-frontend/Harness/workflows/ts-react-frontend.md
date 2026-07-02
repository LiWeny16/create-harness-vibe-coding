# TypeScript React Frontend Workflow

## Required Evidence

- Package manager and scripts detected.
- Typecheck, lint, test, or build results according to project conventions.
- Real-browser smoke or screenshot evidence for user-visible changes.
- Console/runtime error check result for the changed screen or flow.
- Notes on responsive behavior and important interaction states.
- Stable accessible labels/roles and stable test selectors such as `data-testid` are required for critical UI controls and states: inputs, buttons, filters, rows, empty/error/loading states.

Typecheck, build, and unit tests are necessary signals but are not enough for user-visible React changes. Before claiming UI acceptance, load the app in a real browser by Playwright, Chrome DevTools/CDP, or a documented manual run and capture screenshot/trace/console evidence.
For TS/React UI work, capture the selector contract in the feature doc before implementation so tests and manual checks can target stable selectors instead of component internals or brittle DOM paths.

## Common Commands

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
pnpm test
yarn test
```

Use the package manager and scripts already present in the repository.

## Fallback

If no formal checks exist, run the closest available build or dev command, inspect the changed UI manually, and document the missing automation. Do not add dependencies unless the task requires it and the user approves.

## Windows Notes

Use PowerShell syntax for environment variables: `$env:VITE_API_URL='http://localhost:8000'; npm run dev`. Quote paths and prefer package scripts over shell-specific command chains.
