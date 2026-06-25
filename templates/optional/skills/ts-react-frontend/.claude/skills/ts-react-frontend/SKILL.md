---
name: ts-react-frontend
description: TypeScript React frontend workflow for components, state, routing, typecheck, tests, builds, and browser smoke evidence.
---

# TypeScript React Frontend

## When To Use

Use this skill when changing React components, hooks, routes, client state, styling, build configuration, or frontend tests.
For user-visible changes, typecheck, build, and unit tests are not enough; include real-browser smoke or screenshot evidence before claiming acceptance.

## Docs To Load

- `Harness/workflows/ts-react-frontend.md`
- `Harness/PROGRESS.md` and current task `tasks/<id>/PLAN.md`
- Existing frontend README, package scripts, design system, and test setup.

## Required Inputs

- Screen, component, or flow being changed.
- Expected behavior and acceptance criteria.
- Existing package manager and verification commands.
- Selector contract: stable accessible labels/roles and `data-testid` hooks for critical inputs, buttons, filters, rows, empty/error/loading states, and other targetable UI states.

## Allowed Writes

- Frontend source, styles, tests, and focused docs in task scope.
- Generated evidence such as screenshots or test reports in existing artifact paths.
- Current task `tasks/<id>/PLAN.md` when tracking a plan item.

## Output Format

Return changed files, UI behavior summary, commands run, browser or test evidence, and unresolved risks.
Include selectors added or verified for CDP/Playwright/manual checks.

## PROGRESS.md & Task PLAN.md Updates

Update `Harness/tasks/<task-id>/PLAN.md` only when executing a tracked task or recording required validation evidence.

## dispatch.md Usage

Use `Harness/dispatch.md` when independent frontend tasks can run in parallel, such as components, tests, and browser checks.
