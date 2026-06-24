# Harness Architecture — {{projectName}}

> **Responsibility**: Defines the system layering structure, component overview, and key design decisions.
> **Does NOT cover**: Code details (AI can read code), API documentation (placed in docstrings).
>
> Philosophical sources: arc42 Chapter 5 (Building Block View) + C4 Model Level 3 (Component) + matklad's lightweight ARCHITECTURE.md.

---

## 1. Layering Rules

<!-- This is the hardest constraint in the entire architecture. Each layer's "allowed dependencies" must be explicit. -->

```
┌──────────────────────────┐
│     interfaces/          │  ← User entry (CLI / API / UI)
│     May depend on: harness│
├──────────────────────────┤
│     harness/             │  ← Generic runtime shell: orchestration,
│     May depend on:        │     security, auditing, scheduling
│       application         │     Contains no business rules
├──────────────────────────┤
│     application/         │  ← Business use-case orchestration
│     May depend on: domain │
├──────────────────────────┤
│     domain/              │  ← Pure business objects + port protocols
│     Only depends on:      │     Depends on no external implementations
│       standard library    │
├──────────────────────────┤
│     infrastructure/      │  ← Adapter implementations (data sources,
│     Implements domain     │     external services)
│       ports               │
└──────────────────────────┘
```

**Hard Constraints**:
- domain must never import infrastructure/ or interfaces/
- application only depends on domain
- harness coordinates workflows but contains no domain business rules
- All cross-layer communication goes through port protocols defined in domain

---

## 2. Interface Decoupling

Use interfaces or ports to protect real boundaries, not to create abstraction for its own sake.

- Define a port when code crosses a layer, process, network, storage, SDK, browser, or permission boundary.
- Keep domain and application logic independent from infrastructure adapters.
- Pass data through explicit contracts instead of reaching into another feature's internals.
- Prefer direct calls inside the same cohesive module when there is only one caller, one implementation, and no boundary to protect.
- Avoid speculative abstraction: do not add factories, plugin systems, service locators, generic repositories, or config layers until the feature has a concrete second use or a real testability/replacement need.

---

## 3. State Design

State must have one owner, legal transitions, and observable recovery behavior.

- Identify durable state, runtime cache, derived UI state, external system state, and audit/event history separately.
- Name the owner of each state slice; do not let UI, application services, and infrastructure all mutate the same state directly.
- Model long-running workflows with explicit states, guards, and failure transitions in `Harness/state-machines.md`.
- Store resumable progress and recovery decisions in `Harness/PLAN.md#Heartbeat` or project-owned durable storage, not only in chat.
- Keep state minimal: derive values when cheap, persist only what must survive reload, retry, or handoff.

---

## 4. Harness Core Components

### 4.1 Runner / Loop

- **Responsibility**: Drives a task from input to completion: loading context, calling application use-cases, handling stop conditions.
- **Design Decision**:
  - Runner only orchestrates, does not interpret domain meaning — Rationale: keeps harness reusable across different business domains
  - Stop conditions are explicitly modeled — Rationale: prevents agent loops from running indefinitely or silently half-completing
- **Does NOT handle**: Business rules, domain object creation details, external service implementations

### 4.2 Permission Policy

- **Responsibility**: Decides whether a given tool, file, network, or external action is allowed to execute.
- **Design Decision**:
  - High-risk actions are denied by default, allow rules are explicitly declared — Rationale: the platform must first guarantee security boundaries
- **Does NOT handle**: Judging whether a business action is correct

### 4.3 Event Bus / Audit Trail

- **Responsibility**: Records task lifecycle, tool invocations, failures, human approvals, and final results.
- **Design Decision**:
  - Events are append-only, audit records cannot be overwritten in place — Rationale: facilitates replay, debugging, and post-mortem analysis
- **Does NOT handle**: Saving final data on behalf of business systems

### 4.4 State / Checkpoint Store

- **Responsibility**: Saves recoverable state, context summaries, task progress, and interrupt points.
- **Design Decision**:
  - State format must be serializable — Rationale: enables replay, resume, testing, and migration
- **Does NOT handle**: Long-term business database modeling

### 4.5 Tool Registry

- **Responsibility**: Registers callable tools along with their input/output contracts, permission labels, and error semantics.
- **Design Decision**:
  - Tool contracts explicitly specify input, output, errors, and side effects — Rationale: reduces the probability of agent tool misuse
- **Does NOT handle**: Internal business implementation of tools

---

## 5. Architectural Constraints (Non-Negotiable)

- `domain/` only defines business models, business invariants, and port protocols; does not import `harness/`, `infrastructure/`, or `interfaces/`.
- `harness/` may orchestrate workflows, security gates, auditing, and stop conditions, but must not determine business meaning.
- All cross-layer external capabilities are expressed through `domain` ports; adapter implementations live in `infrastructure/`.
- Rejections and failures must be testable or documented with manual verification steps in the feature doc.
- Audit events are append-only, never overwritten in place.
