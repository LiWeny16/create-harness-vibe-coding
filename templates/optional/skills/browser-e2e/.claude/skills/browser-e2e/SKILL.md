---
name: browser-e2e
description: Mandatory real-browser smoke and end-to-end verification using Playwright, Chrome DevTools/CDP, or documented manual browser evidence.
---

# Browser E2E

## When To Use

Use this skill when a change affects browser-visible behavior, navigation, forms, routing, layout, or client-side integration. Web/UI acceptance requires loading the app in a real browser before claiming the UI is done.

## Docs To Load

- `Harness/workflows/browser-e2e.md`
- `Harness/PLAN.md`
- Existing project test, build, and run instructions.

## Required Inputs

- Target URL or command to start the app.
- User flows or pages to verify.
- Expected behavior and supported viewport/browser scope.
- Selector contract: stable accessible labels/roles and `data-testid` hooks for critical inputs, buttons, filters, rows, empty/error/loading states, and other targetable UI states.

## Allowed Writes

- Browser test files in the project's existing test locations.
- Evidence artifacts such as screenshots, traces, or reports in existing artifact folders.
- Notes in `Harness/PLAN.md` when the active task asks for plan tracking.

## Output Format

Return changed files, commands run, browser evidence paths, verified flows, failures, and follow-up risks.
Include the selectors used for CDP/Playwright/manual verification.

## PLAN.md Updates

Update `Harness/PLAN.md` only when executing a tracked plan item or recording evidence requested by the current task.

## dispatch.md Usage

Use `Harness/dispatch.md` only when splitting independent browser checks across workers is explicitly useful.
