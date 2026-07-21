# 0-1 Product Lifecycle

Use when starting a new product, clarifying a vague idea, or deciding the next phase.

## Phase Contract

| Phase | Input | Output | Gate |
| --- | --- | --- | --- |
| Idea | user intent | problem, target user, non-goals | unclear points asked or assumptions recorded |
| Research | problem and constraints | `research/research-results.md` | `research/README.md` followed; at least 3 references or explicit reason not possible |
| PRD | research decision | `research/PRD.md` or task Mini PRD | goal, scope, non-scope, user flow, and verification commands are explicit |
| Acceptance | PRD | AC IDs in `ACCEPTANCE.md` section, feature doc, or task PLAN | every user-visible behavior has Given/When/Then and evidence method |
| Contract | acceptance criteria | UI/API/state contract tables | UI selectors, API payloads, state changes, and negative assertions are testable |
| Test Plan | contracts | `TEST_PLAN.md` section or task PLAN verification matrix | tests map to AC IDs before implementation starts |
| Architecture | PRD and contracts | `Harness/architecture.md` | boundaries and first ports are defined |
| Plan | PRD, AC, contracts, architecture | `Harness/tasks/<task-id>/PLAN.md`, optional `Harness/dispatch.md` | tasks have owners, write sets, forbidden truth files, and verification |
| Build | plan and tests | minimal vertical slice | implementation satisfies AC IDs without modifying truth files |
| Independent Validation | running slice | acceptance result matrix, screenshots/traces/logs | validator is not implementer; no unresolved critical/high findings |
| Debug | failed AC evidence | root-cause handoff and smallest fix | failing layer identified before edits |
| Memory | verified or repeated failure | concise memory entry or no-op rationale | durable lessons recorded without secrets |

## Operating Rules

- Move one phase at a time unless the user explicitly asks for a fast lane.
- Start coding only after PRD-GATE, AC-GATE, CONTRACT-GATE, TEST-GATE, and minimum architecture gates pass.
- Prefer one thin vertical slice over broad scaffolding.
- If feedback changes scope, update PRD and acceptance criteria before implementation.
- If implementation reveals a boundary problem, update architecture or ports before continuing.
- If implementation reveals incorrect acceptance criteria or contracts, stop and use Change Request from `ACCEPTANCE_PROTOCOL.md`; do not let the implementer rewrite truth files directly.

## Fast Lane

Small edits may skip full lifecycle when all are true:

- user intent is clear
- one file or one narrow behavior
- no architecture, permission, or public API change
- one verification command or one manual check is enough
- Mini PRD, AC IDs, and verification evidence still fit inside the task PLAN
