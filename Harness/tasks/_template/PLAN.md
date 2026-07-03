# {{TASK_ID}} - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.
Link files or command names instead of pasting logs or subagent transcripts.

> Task ID: kebab-case, under 60 chars. Directory name = task ID.

## Goal

- Outcome:
- Non-goals:

## Decisions

-

## Acceptance

Default: keep 1-3 concise ACs. Expand only for UI/API/security/data-loss,
cross-module, or other high-risk behavior.

- AC-001:

Expanded evidence required when triggered:
- UI/browser-visible: add selector contract and real browser evidence.
- API/integration: add endpoint/payload/response contract.
- High-risk behavior: add AC-by-AC validation matrix.

## Scope

Allowed write set:
-

Forbidden:
-
- Truth files (PRD, ACs, UI/API contracts, test plan, validation report) unless a Change Request is recorded.

## Context

- Loaded:
- Assumptions:

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|

## Verification

- [ ]

## Risks

-

## Expanded Contracts

Use this section only when the Acceptance triggers above apply.

### UI Contract

| Element | Selector / Role | States | AC IDs |
|---------|-----------------|--------|--------|

### API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
