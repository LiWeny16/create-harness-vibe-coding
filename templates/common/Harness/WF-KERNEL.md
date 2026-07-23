# WF Kernel — Shared Orchestration Engine

The WF Kernel is the shared engine for `/wf`, `/wf-max`, `/wf-auto`, `/wf-auto-spark`, `/wf-review`, and `/wf-browser`. Variants extend the kernel; they do not duplicate the orchestration logic.

## Cache-First Context Contract

All WF variants preserve prompt-cache shape: stable workflow instructions and
deterministic dispatch schema first; task-specific state, current runtime facts,
and latest tool outputs last. Use
`Harness/context-loading.md#Cache-First Context Contract` for load ordering.
Dispatch packets keep canonical field order, load only selected skills/tools,
and return bounded summaries through `MaxReturnTokens` and `ReturnSchema`
instead of transcripts.

## Role / Model Matrix

The orchestrator dispatches agents by role, model tier, and task type. No single agent type handles all work.

### Small-Fast (haiku)

Chore and scoped read-only work. Dispatch early and often.

| Agent | Writes | Purpose |
|---|---|---|
| `task-scribe` | Task state only | Heartbeat, dispatch ledger, evidence pointers, compact PLAN/PROGRESS updates |
| `codebase-explorer` | None | Scoped read-only source exploration, file discovery, symbol tracing |
| `context-master` | Heartbeat compression line only | Context analysis, compression suggestions |

### Standard (sonnet)

Most decision-bound and implementation work.

| Agent | Writes | Purpose |
|---|---|---|
| `planner` | None (returns PLAN patch) | Task decomposition, dependencies, writeSet, verification commands |
| `researcher` | None (returns research patch) | Product, market, dependency, ecosystem research |
| `docs-researcher` | None | Official docs, API, SDK, version, limits |
| `architect` | None (returns architecture patch) | Boundaries, ports, data flow, state impact, migration risks |
| `test-writer` / `tdd-guide` | Tests/plan only | AC-linked failing tests, manual verification plans |
| `implementer` | Assigned writeSet only | Minimal production code changes |
| `debugger` | Smallest fix path | Root-cause isolation and fix |
| `verifier` | None | Command execution, AC evidence, validation matrix |
| `reviewer` | None | Spec/code/security/architecture/test review findings |
| `reflector` | None | Closeout synthesis, PASS/RETURN_TO_DEBUG/BLOCKED verdict |
| `memory-master` | Memory files + MEMORY.md index | Durable memory write, dedup, consolidation |

### High-Reasoning (opus)

Reserved for architecture conflicts, security/data-loss risk, multi-layer ambiguity, or user explicitly requests.

### WF-MAX Managers (sonnet)

| Manager | Spawns | Purpose |
|---|---|---|
| `explore-manager` | 5-10 read-only researchers/explorers | W0 exploration fan-out |
| `architect-manager` | 3 architects | W1 boundary/interface contracts |
| `implement-manager` | 5-7 implementers (one file_claim each) | W2 parallel implementation |
| `review-manager` | 3-4 reviewers (spec/code/security/perf) | W2R review fan-out |

## Dynamic Ready-Queue Orchestration

`/wf` is NOT a fixed serial pipeline. It uses a dependency-driven ready queue, persisted across sessions via [WF-STATE.md](WF-STATE.md).

```text
while task not accepted:
    update readyQueue from dependency graph

    // Phase-independent: dispatch anything ready
    dispatch all ready read-only agents in parallel
        (codebase-explorer, docs-researcher, researcher, planner, architect)
    dispatch task-scribe to maintain state alongside any work

    // Write gate: only when AC + contracts + test plan exist
    for each independent writeSet:
        dispatch implementer (one file_claim each)
        wait for wave complete
        dispatch verifier on completed wave

    // Review gate: wave-level, not end-of-task
    when verifier evidence exists for a wave:
        dispatch reviewer(s) on that wave

    // Fix gate: on-demand only
    if review finding or failed AC:
        dispatch debugger or implementer (smallest fix)
        re-run verifier on the fixed wave

    // Reflect gate: WF-Full only, or risk-triggered
    if WF-Full or unresolved contradiction or high-risk behavior:
        dispatch reflector before final acceptance

    // Closeout
    task-scribe records final state
    if durable lesson found:
        dispatch context-master -> memory-master

    stop on: accepted | blocked | user decision required
```

### Concurrency Rules

1. Read-only agents always run in parallel (different readSets = no conflict).
2. `task-scribe` runs alongside any wave — task state is its own writeSet, disjoint from source.
3. Write agents serial within wave; parallel across waves only when writeSets are disjoint.
4. `verifier` launches per-wave as soon as that wave's write agents complete.
5. `reviewer` launches per-wave when verifier evidence is ready.
6. `debugger` launches on-demand when a specific AC or review finding fails.
7. `reflector` launches only in WF-Full, or when risk/contradiction is detected.
8. Idle capacity is immediately filled with the next ready item from the queue.

## Dispatch Packet (Extended)

Every dispatch MUST carry:

```text
Role:
Objective:
TaskType:           ui-browser | api-backend | architecture-migration | docs-readme | dependency-sdk | bug-fix | refactor | chore
ModelTier:          small-fast | standard | high-reasoning
AgentName:
Skills:             list or none
ReadSet:
WriteSet:
Forbidden:
AC IDs:
MaxReturnTokens:
ReturnSchema:
```

## Task Type → Agent/Skill Routing

| Task Type | Primary Agents | Skills |
|---|---|---|
| UI/browser behavior | test-writer, implementer, verifier, reviewer | browser-e2e, wf-browser |
| API/backend | docs-researcher, test-writer, implementer, verifier, reviewer (security) | tdd |
| Architecture/migration | architect, codebase-explorer, planner, reviewer | — |
| Docs/README | wf-readme, reviewer, task-scribe | wf-readme |
| Dependency/SDK/API upgrade | docs-researcher, researcher, implementer | — |
| Bug/failing test | debugger, verifier, implementer, reviewer | tdd |
| Large refactor | planner, architect, codebase-explorer fan-out, implement-manager, review-manager | — |
| Task state/log/evidence only | task-scribe (haiku) | — |
| Source discovery/tracing | codebase-explorer (haiku) fan-out | — |

## Tier-Aware Acceptance Gates

Acceptance is tier-dependent. No single gate covers all tiers.

### WF-Light

1-2 files, well-understood, low risk.
- planner + test-writer + implementer + verifier
- Task-scribe maintains state throughout
- Codebase-explorer optional
- **Acceptance**: verification passes + task state recorded = closeout
- Cross-review and reflector are NOT mandatory
- Heartbeat: phase boundaries, failure, closeout

### WF-Standard

Multi-file or behavior change.
- WF-Light baseline + research/docs + at least one independent review lens
- Parallel: codebase-explorer(s), docs-researcher/researcher, planner, task-scribe
- **Acceptance**: verifier evidence + one review PASS = closeout
- Reflector: triggered only by risk, contradiction, or high-impact behavior
- Heartbeat: wave boundaries, failure, blocker, closeout

### WF-Full

High-risk, cross-layer, security/data-loss, browser/API acceptance, ambiguous architecture.
- Full chain: planner + research/docs + architect + test-writer + implementer + verifier + multi-review + reflector
- **Acceptance**: cross-review PASS + reflector PASS
- Maximize parallel reads; serial writes only when writeSets overlap
- Heartbeat: wave boundaries, gate results, failure, blocker, closeout

### WF-MAX

`/wf-max` = `/wf` kernel + maximum safe fan-out. It is NOT a separate workflow.

Delta from `/wf`:
- Tasks are decomposed into smallest safe write-units
- Each write-unit = one file_claim = one implementer Worker
- Managers coordinate per-domain fan-out (explore, architect, implement, review)
- CEO/controller never writes source; delegates all production edits to Workers
- WF-Max-Useful (default): fan-out only where writeSets are meaningfully independent
- WF-Max-Strict (explicit `--strict`): unconditional fan-out per span formula
- Disjoint writeSets → parallel; overlapping → serial wave or worktree isolation
- task-scribe continuously maintains dispatch ledger and heartbeat
- `idleWorker -> nextReady` queue: dispatch immediately when a slot opens
- Write workers return <=250 tokens + evidence/file paths

## State Ownership

- **Controller (main agent or CEO)**: owns decisions, decomposition, synthesis, final verification, dispatch
- **task-scribe**: writes task state (PROGRESS, PLAN, ARTIFACTS, NOTES). Controller or CEO supplies structured updates; task-scribe formats and writes them.
- **Production source agents (implementer, debugger, test-writer)**: write ONLY their assigned writeSet. Never write task state.
- **Reviewer, verifier, reflector, architect, planner, researcher**: read-only. Return findings/patches to controller for synthesis.

Old rule: "Only main agent writes task PROGRESS/PLAN."
New rule: "Only controller or task-scribe writes task state. Production source agents never write task state unless explicitly dispatched as task-scribe."
