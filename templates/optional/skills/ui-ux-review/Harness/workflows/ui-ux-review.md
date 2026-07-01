# UI/UX Review Workflow

## Required Evidence

- Screenshots for desktop and mobile views.
- Notes on layout, typography, interaction states, accessibility, and empty/loading/error states.
- Any automated accessibility, lint, or visual test output available in the project.

## Common Commands

```powershell
npm run dev
npm run lint
npm run test
npx playwright test
```

Use the project's existing commands first. Browser screenshots may come from Playwright, CDP, framework tooling, or manual capture.

## Fallback

When automation is unavailable, inspect the running UI manually at representative viewport sizes and document findings with screenshots. Avoid adding design or test dependencies without approval.

## Windows Notes

PowerShell does not support POSIX inline environment variables. Use `$env:NAME='value'; command` and quote screenshot paths with spaces.
