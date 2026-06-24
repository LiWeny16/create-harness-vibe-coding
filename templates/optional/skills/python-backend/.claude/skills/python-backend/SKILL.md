---
name: python-backend
description: Python backend workflow for API changes, service logic, FastAPI-style routes, and unittest or pytest verification.
---

# Python Backend

## When To Use

Use this skill when changing Python API routes, service logic, persistence boundaries, background jobs, or backend tests.

## Docs To Load

- `Harness/workflows/python-backend.md`
- `Harness/PLAN.md`
- Project backend README, API docs, dependency files, and test configuration.

## Required Inputs

- Target behavior, endpoint, service, or bug.
- Existing test command and runtime setup.
- Database, environment variable, or fixture constraints.

## Allowed Writes

- Python source, tests, fixtures, and backend docs in the task scope.
- Local evidence artifacts such as test output snippets.
- `Harness/PLAN.md` when the task requires plan tracking.

## Output Format

Return files changed, API or behavior summary, tests run, important logs, migration/config notes, and remaining risks.

## PLAN.md Updates

Update `Harness/PLAN.md` only when executing a tracked plan item or recording required validation evidence.

## dispatch.md Usage

Use `Harness/dispatch.md` for separable backend work such as API implementation, database changes, and test coverage.
