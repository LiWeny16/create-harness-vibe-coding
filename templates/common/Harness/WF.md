# WF Mode — Dynamic Orchestration Kernel

`/wf` is a **dynamic workflow kernel**, not a fixed serial pipeline. The orchestrator (main agent) makes decisions, dispatches agents, synthesizes returns, and owns final acceptance. It does NOT do bulk source reading, log scraping, or task-state paperwork — those are delegated to appropriate subagents.

WF is **explicit only**. Complexity does not auto-trigger WF.

## Shared Kernel

All WF variants (`/wf`, `/wf-max`, `/wf-auto`, `/wf-auto-spark`, `/wf-review`, `/wf-browser`) share the orchestration engine defined in [WF-KERNEL.md](WF-KERNEL.md). That file is the authoritative source for:

- Role / Model Matrix (which agent, which model tier, for which work)
- Dynamic ready-queue pseudocode
- Dispatch packet fields
- Task type → agent/skill routing
- Tier-aware acceptance gates
- State ownership rules (controller + task-scribe)

Resumable state follows [WF-STATE.md](WF-STATE.md): STATE.json is the machine-readable resume truth; the ready queue is persisted there across sessions.

This file defines the `/wf` user contract, tiers, and the standard orchestration loop.

## Trigger

WF is **explicit only**. Enter WF ONLY when the user explicitly types:
- `/wf`, `$wf`, `/skills wf`

These are NOT WF triggers:
- Multi-step work, multi-file changes, complexity, uncertainty, architecture scope, browser/API behavior, repeated failure
- Those may need planning, subagents, or tests — but not WF

## Memory Preflight

1. Load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md`.
2. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match.
3. Record `Memory preflight: done` and `Memory hints: none | <file/path + reason>`.

## Cache Discipline

Follow `Harness/context-loading.md#Cache-First Context Contract`: keep the
listed router/workflow loads in stable order, load only routed skills/tools, and
append task state, current runtime facts, and latest tool output after the
stable docs. Do not bulk-load skill bodies, tool schemas, or `Harness/`.

## Standard Orchestration Loop

The `/wf` kernel follows a dependency-driven ready-queue, NOT a fixed serial phase list.

```text
Intake
-> Understand user goal; ask <=3 blocking decision questions (each with recommendation)
-> Requirement analysis: scope, non-goals, risks, acceptance direction
-> Mini PRD (compact, not a large document)
-> 1-3 ACs (expand only for high-risk triggers)
-> Plan: task split, dependencies, readSet/writeSet, verification commands, subagent dispatch

// Ready-queue dispatch (NOT serial phase)
while task not accepted:
    update readyQueue from dependency graph

    // Read-only and chore — always parallel when ready
    dispatch codebase-explorer(s) for scoped source reading
    dispatch docs-researcher / researcher as needed
    dispatch planner for decomposition (unless already done)
    dispatch task-scribe alongside any work

    // Write gate
    for each independent writeSet:
        dispatch implementer (one file_claim each)
        when wave complete: dispatch verifier

    // Review gate — wave-level, not end-of-task
    when verifier evidence exists for a wave:
        dispatch reviewer(s) on that wave

    // Fix gate — on-demand
    if review finding or failed AC:
        dispatch debugger or implementer (smallest fix)
        re-run verifier

    // Reflect gate — WF-Full only or risk-triggered
    if WF-Full or unresolved contradiction:
        dispatch reflector

    // Closeout
    task-scribe records final state
    if durable lesson: context-master -> memory-master

    stop on: accepted | blocked | user decision required
```

## WF Tiers

### WF-Light
1-2 files, well-understood, low risk.
- planner + test-writer + implementer + verifier
- task-scribe maintains state
- codebase-explorer optional
- **Acceptance**: verification passes = closeout
- Cross-review and reflector NOT mandatory

### WF-Standard
Multi-file or behavior change.
- WF-Light baseline + research/docs + at least one independent review lens
- Parallel: codebase-explorer(s), docs-researcher/researcher, planner, task-scribe
- **Acceptance**: verifier evidence + one review PASS = closeout
- Reflector: only when risk, contradiction, or high impact triggers

### WF-Full
High-risk, cross-layer, security/data-loss, browser/API acceptance, ambiguous architecture.
- Full chain per [WF-KERNEL.md](WF-KERNEL.md) Role/Model Matrix
- **Acceptance**: cross-review PASS + reflector PASS

## State Ownership

Per [WF-KERNEL.md](WF-KERNEL.md):
- **Controller** (main agent): decisions, decomposition, synthesis, final verification
- **task-scribe** (haiku): writes task state (PLAN, PROGRESS, ARTIFACTS, NOTES). Controller supplies structured updates; task-scribe formats and writes.
- **Production source agents**: write ONLY their assigned writeSet. Never write task state.

## Exploration

Controller delegates source reading to subagents. Controller does NOT read source files directly before dispatch.

First wave — dispatch in parallel:
- codebase-explorer(s): scoped source discovery
- planner: decomposition, dependencies, writeSet
- researcher / docs-researcher: external context as needed
- task-scribe: compact heartbeat and dispatch ledger

Second wave — after synthesis:
- architect (if cross-layer or architecture risk)
- test-writer: failing tests from AC IDs

## Browser and API Evidence

See [HARNESS_BRIDGE.md](HARNESS_BRIDGE.md) and [WF-KERNEL.md](WF-KERNEL.md) Task Type Routing for UI/browser and API/backend task types.

Agents live under `.claude/agents/` and `.opencode/agents/`. Task state lives under `Harness/tasks/<task-id>/`.

## Closeout

Closeout is tier-aware. WF-Light: verification + task state update = done. WF-Full: full gate chain per [WF-KERNEL.md](WF-KERNEL.md).
