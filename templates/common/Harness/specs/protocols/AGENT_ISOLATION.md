# Agent Isolation

Purpose: prevent self-review, test backfilling, and context leakage in acceptance-driven work.

## Hard Rules

- The agent that implements code must not be the agent that accepts the code.
- The agent that writes tests must not derive tests from the implementation.
- The reviewer must read PRD, acceptance criteria, contracts, diff, and run evidence directly.
- The validator validates against PRD-derived AC IDs and running behavior, not the implementer's summary.
- The debugger must locate a root cause from failure evidence before editing.

## Context Isolation Matrix

| Role | May Read | Must Not Read / Trust |
| --- | --- | --- |
| Planner | user request, project background, memory, research | implementation files as a reason to skip PRD |
| Acceptance Agent | PRD, user scenarios, UI requirements, business rules | implementation code for reverse-engineering AC |
| Contract Agent | PRD, AC, API/schema docs, UI requirements | implementation shortcuts as contract truth |
| Test Writer | AC, UI contract, API contract, test utilities | production implementation as the source of expected behavior |
| Implementer | PRD, AC, contracts, tests, relevant code | permission to change AC/contracts without Change Request |
| Reviewer | PRD, AC, contracts, diff, test result, trace, screenshot | implementer summary as sole evidence |
| E2E Validator | PRD, AC checklist, contracts, running app URL, test command | implementation plan or private rationale |
| Debugger | failing logs, traces, screenshots, diff, narrow relevant files | broad source areas without a failure hypothesis |
| Memory Master | final result, repeated failure patterns, verified lessons | secrets, credentials, raw noisy transcript |

## Permission Isolation

Dispatch packets must declare `Read set`, `Write set`, and `Forbidden`.

| Role Type | Default Write Permission |
| --- | --- |
| Planner / Acceptance / Contract | truth docs only, when explicitly assigned |
| Test Writer | tests and test fixtures only |
| Implementer | assigned implementation files only |
| Reviewer / Validator | none |
| Debugger | smallest assigned fix set after reproduced failure |
| Memory Master | memory files only |

Implementer forbidden set must include truth files unless a Change Request has been approved:

- PRD
- Acceptance Criteria
- UI Contract
- API Contract
- Test Plan
- Validation Report

## Reviewer Evidence Rule

Reviewer must inspect:

- PRD or Mini PRD
- Acceptance Criteria IDs
- UI/API contracts relevant to the diff
- actual diff
- test/validation command output
- browser/API evidence when user-visible behavior is affected

Reviewer output must classify findings by severity and cite AC IDs when applicable.

## Validator Evidence Rule

Validator receives only:

- PRD or Mini PRD
- Acceptance Criteria
- UI/API contracts
- running app URL or API endpoint
- verification commands
- expected evidence locations

Validator does not need implementation intent. If validation fails, the handoff goes to Debugger with evidence, not to Implementer for blind edits.
