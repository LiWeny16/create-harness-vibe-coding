# WF Max — Maximum Parallelism Workflow (Three-Tier Enterprise Hierarchy)

Use when the task can be decomposed into many independent units and parallelism benefit outweighs coordination cost. Triggered by `/wf max` or `wf max`.

WF Max organizes agents into a three-tier hierarchy: CEO (main controller), Managers (domain owners), and Workers (single-unit executors). This mirrors proven organizational models (military rule-of-3, Amazon two-pizza teams, management span-of-control research) and replaces the older flat dispatch model with bounded communication, clear ownership, and predictable scaling.

## Trigger

Enter WF Max mode when:
- The user explicitly says `/wf max` or `wf max`.
- A WF-mode task has a write set spanning 5+ files with clear disjoint boundaries.
- The controller identifies 3+ independently testable implementation units.

## Three-Tier Organization

Every WF Max execution follows this structure:

```
TIER 1: CEO (1 agent — the main controller / user-facing agent)
  |
  +-- TIER 2: Managers (1-5 domain-owner subagents, serial across domains)
  |     |
  |     +-- Architect-Manager: owns boundaries, interfaces, data contracts
  |     +-- Implementation-Manager: owns write-set partitioning and integration
  |     +-- Review-Manager: owns spec/code/security/perf review gates
  |     +-- Exploration-Manager (optional, large projects): owns research scoping
  |
  +-- TIER 3: Workers (manager_count * span, parallel within a domain)
        |
        Architect-Manager workers: boundary-researcher, interface-designer, data-flow-mapper
        Implementation-Manager workers: implementer-1..N (one file claim each)
        Review-Manager workers: reviewer-spec, reviewer-code, reviewer-security, reviewer-perf
        Exploration-Manager workers: researcher-1..N, domain-explorer-1..N
```

**CEO responsibilities:**
1. Intake the task and run the confidence gate (95% intent clarity).
2. Partition work into domains and assign Managers.
3. Receive synthesized Manager reports.
4. Run integration verification.
5. Execute closeout (context-master + memory-master).

**Manager responsibilities:**
1. Receive domain scope from CEO.
2. Partition work into worker-sized units.
3. Dispatch workers in parallel within the domain.
4. Synthesize worker returns into a single integrated report.
5. Return the synthesized report to CEO.

**Worker responsibilities:**
1. Execute a single bounded unit of work (one file, one review dimension, one research topic).
2. Return raw results to the owning Manager.
3. Do NOT communicate with other workers or with the CEO directly.

## Span Formula

The number of workers a Manager should dispatch is bounded by the domain's complexity:

```
span = min(7, ceil(sqrt(files_in_domain)))

Where:
  Complex domain (architecture, interfaces, boundary decisions):  span = 3
  Standard domain (implementation, code changes):                span = 5-7
  Simple domain (research, documentation, exploration):          span = 7-10
```

The sqrt formula provides a data-driven floor. The domain-type caps prevent communication overload in complex domains where worker outputs are highly interdependent.

**Why span matters:** Beyond ~7 direct reports, a Manager's synthesis cost grows quadratically (comparing N worker returns against each other). The span formula keeps synthesis cost linear to sub-linear.

## Organization Sizing Table

Project scale determines how many tiers and agents to activate:

| Scale | Files | CEO | Managers | Avg Span | Workers | Total Agents |
|-------|-------|-----|----------|----------|---------|-------------|
| XS | 1-4 | 1 | 0 | -- | 1-3 | 2-4 |
| S | 5-12 | 1 | 2 | 3 | 6 | 9 |
| M | 13-30 | 1 | 3 | 5 | 15 | 19 |
| L | 31-60 | 1 | 5 | 7 | 35 | 41 |
| XL | 60+ | 1 | 7 | 7+ | 49+ | 57+ |

**XS projects (1-4 files):** Do not use WF Max. CEO handles everything directly or with 1-2 serial subagents. The three-tier overhead exceeds the benefit.

**S projects (5-12 files):** 2 managers: Implementation-Manager + Review-Manager. No Architect-Manager needed; CEO handles architecture decisions directly.

**M projects (13-30 files):** Full three-tier: Architect-Manager, Implementation-Manager, Review-Manager. Each runs serially, dispatching workers in parallel within their domain.

**L projects (31-60 files):** Add Exploration-Manager as Wave 0, plus expanded manager spans. Architect-Manager may need 2 sub-domain workers (boundary-researcher + interface-designer).

**XL projects (60+ files):** Full hierarchy with max spans. CEO must strictly serialize managers and may need to split into multiple WF Max sessions by subsystem.

## Manager Types and Worker Dispatch

### Architect-Manager

**Trigger:** Project has cross-file interfaces, layer boundaries, or new ports/adapters.

**Input from CEO:** Scope, architecture doc, domain/ports.md, current layer map.

**Worker dispatch (parallel, span=3):**
| Worker | Task | Output |
|--------|------|--------|
| boundary-researcher | Map domain boundaries, identify port/interface surfaces | Boundary map with conflict zones |
| interface-designer | Design data contracts, type signatures, API shapes | Interface contract document |
| data-flow-mapper | Trace data through layers, identify failure/retry paths | Data-flow diagram with error paths |

**Manager synthesis:** Merge into a unified boundary decision document. Resolve conflicts between boundary-researcher and interface-designer. Produce updated ports.md content and architecture recommendations.

**Return to CEO:** Boundary decisions, interface contracts, updated ports.md, dependency graph.

### Implementation-Manager

**Trigger:** Write-set is defined and bounded. Architecture decisions are made.

**Input from CEO:** PLAN.md, write-set file list, dependency graph, interface contracts.

**Worker dispatch (parallel, span=5-7):**
1. Run write-set coloring (see Write-Set Partitioning below).
2. Assign each color group to one implementer (1 file = 1 implementer, or 2-5 tightly-related files = 1 implementer).
3. Dispatch all implementers in parallel.
4. Optionally dispatch 1 test-writer per module if tests are independent.

| Worker | Task | Output |
|--------|------|--------|
| implementer-1..N | Write/edit assigned files, match interface contracts | Changed files, conflict report |

**Manager synthesis:** Merge all file changes. Resolve import/seam conflicts. Verify no cross-claim file creation. Run a fast build/lint check. Produce a unified diff report.

**Return to CEO:** Merged file changes, seam resolution notes, build/lint result, any unresolved conflicts.

### Review-Manager

**Trigger:** Implementation wave is complete and merged.

**Input from CEO:** Diff, acceptance criteria, spec document, architectural constraints.

**Worker dispatch (parallel, span=3-4):**
| Worker | Task | Output |
|--------|------|--------|
| reviewer-spec | Verify every acceptance criterion is met | Spec compliance report, gaps |
| reviewer-code | Verify correctness, maintainability, style consistency | Code findings, severity ratings |
| reviewer-security | Verify injection, secrets, auth, input validation | Security findings, severity ratings |
| reviewer-perf | Verify algorithmic complexity, memory, query patterns (L/XL only) | Performance findings |

**Manager synthesis:** Deduplicate findings across reviewers. Assign severity (P0/P1/P2). Produce a single prioritized review report. Do NOT auto-fix; return findings to CEO for dispensation.

**Return to CEO:** Prioritized review report with deduplicated findings and severity ratings.

### Exploration-Manager (Optional, L/XL projects)

**Trigger:** Large project with uncertain scope, external API changes, or new domain exploration.

**Input from CEO:** Research scope, key questions, external dependency list.

**Worker dispatch (parallel, span=3-10):**
| Worker | Task | Output |
|--------|------|--------|
| researcher-1..N | Domain-specific research per assigned topic | Research findings, citations |
| domain-explorer-1..N | Explore external APIs, SDK versions, compatibility | Compatibility report |

**Manager synthesis:** Merge findings, flag conflicts, produce a unified research report.

**Return to CEO:** Research synthesis with adopted/rejected choices and rationale.

## Manager Synthesis Protocol

Every Manager follows this 5-step protocol when integrating worker returns:

```
1. COLLECT: Gather all worker returns. Wait for all parallel workers to complete.
2. DEDUPLICATE: Remove duplicate findings, merge overlapping claims.
3. CONFLICT-RESOLVE: Identify contradictions between worker returns.
   - Same file claimed by 2+ implementers → pick one, report conflict.
   - Contradictory findings from reviewers → flag both, do not reconcile silently.
   - Interface mismatch between workers → report to CEO with both versions.
4. SYNTHESIZE: Produce a single integrated artifact (document, diff, report).
5. REPORT: Return synthesized artifact + raw worker returns as appendix to CEO.
```

**Synthesis quality gates:**
- No silent drops: every worker's output must appear in either the synthesis or an explicit "deferred/rejected" section.
- Conflict transparency: all contradictions are surfaced, not hidden.
- CEO-readiness: the synthesis must be actionable by the CEO without re-reading raw worker returns (raw returns are included for audit only).

**Manager failure handling:**
- If a worker fails (timeout, error), the Manager retries once with refined instructions.
- If the worker fails again, the Manager absorbs the work itself or reports the failure to CEO with a re-plan recommendation.
- If synthesis reveals a gap (missing coverage), the Manager dispatches a gap-fill worker before reporting.

## Communication Overhead Model

The three-tier model explicitly bounds communication links. Flat dispatch (old model) scales at O(n^2); three-tier scales at O(m + sum(s_i^2)) where m = manager count, s_i = span per manager.

```
CEO_to_managers        = manager_count
manager_to_workers     = sum(span_i for each manager)
cross_manager_sync     = manager_count * (manager_count - 1) / 2  (only at handoff points)

Total communication links = CEO_to_managers + manager_to_workers + cross_manager_sync

Efficiency = useful_work_tokens / (useful_work_tokens + communication_tokens)
```

**When NOT to add more tiers:**
- **Fewer than 5 files:** Three-tier overhead exceeds benefit. Use serial WF mode.
- **High cross-domain coupling:** If implementers need real-time coordination across domains, the Manager serialization bottleneck hurts. Use flat dispatch with fewer agents.
- **Single-domain work:** If all changes are in one logical domain, skip managers; CEO dispatches workers directly (flat mode).
- **Mostly read-only research:** Exploration-Manager with 3-7 researchers is sufficient. No need for Architect or Implementation managers.

**Sweet spot analysis:**
| Config | Managers | Span | Workers | CEO Links | Manager Links | Cross-Sync | Total Links | Worker/Link Ratio |
|--------|----------|------|---------|-----------|---------------|------------|-------------|-------------------|
| 2x3 | 2 | 3 | 6 | 2 | 6 | 1 | 9 | 0.67 |
| 3x5 | 3 | 5 | 15 | 3 | 15 | 3 | 21 | 0.71 |
| 5x7 | 5 | 7 | 35 | 5 | 35 | 10 | 50 | 0.70 |
| 7x7 | 7 | 7 | 49 | 7 | 49 | 21 | 77 | 0.64 |

The 3x5 configuration (3 managers, span=5, 15 workers, 21 links) is the efficiency sweet spot. Beyond 7 managers, cross-manager sync dominates and produces diminishing returns. For projects needing more than 35 workers, split into multiple WF Max sessions by subsystem.

## Orchestration Shape

```text
CEO INTAKE + CONFIDENCE GATE

WAVE 0: EXPLORATION (CEO -> Exploration-Manager -> explorers)
  Optional. L/XL projects only.
  Exploration-Manager dispatches: researcher-1..N, domain-explorer-1..N (parallel, span 3-10)
  Manager synthesizes -> dependency graph + domain map -> returns to CEO

CEO SYNTHESIS: Partition into domains, assign managers, set spans

WAVE 1: ARCHITECTURE (CEO -> Architect-Manager -> architect workers)
  Architect-Manager dispatches: boundary-researcher, interface-designer, data-flow-mapper (parallel, span=3)
  Manager synthesizes -> boundary decisions + interface contracts + ports.md updates -> returns to CEO

CEO GATE: Approve architecture before implementation. Re-plan if boundaries shift.

WAVE 2: IMPLEMENTATION (CEO -> Implementation-Manager -> implementers)
  Implementation-Manager:
    1. Runs write-set coloring on approved file list
    2. Assigns file claims to implementers (disjoint, 1 file or small module each)
    3. Dispatches 3-7 parallel implementers (span from formula)
    4. Optionally dispatches test-writer per module
    5. Integrates returns, resolves imports/seams, runs build/lint
    6. Reports merged diff + build result to CEO

WAVE 2 REVIEW: (CEO -> Review-Manager -> reviewers)
  Review-Manager dispatches: reviewer-spec, reviewer-code, reviewer-security (parallel, span 3-4)
  Manager synthesizes findings -> dedup + severity -> reports to CEO

CEO FIX DISPENSATION: Assign P0/P1 fixes. Dispatch fix-implementer(s) or re-run Wave 2.

WAVE 3+: DEPENDENT IMPLEMENTATION (same pattern as Wave 2)
  Only files that depend on Wave 2 output. Same Implementation-Manager + Review-Manager cycle.

INTEGRATION: CEO runs verifier
  verifier executes full integration checks (build, lint, test, type-check).
  If failed: debugger on smallest failure -> CEO dispenses fix -> re-verify.
  Loop cap: 3 same-class failures -> memory-master records -> ask user.

CLOSEOUT: CEO dispatches context-master + memory-master (manager-less, direct dispatch)
  context-master: extracts parallelism-effectiveness patterns, compression suggestions
  memory-master: records what worked for future task decomposition
```

**Wave dispatch rules (wave dispatch):**
- Managers run serially across domains (each Manager receives CEO handoff, dispatches workers, synthesizes, returns to CEO, then next Manager starts).
- Workers run in parallel within a single Manager's domain.
- CEO must verify each wave's output before starting the next wave. No wave pipelining.
- The Saturation Cap applies per-wave: total concurrent agents (CEO + active Manager + workers + any stragglers) must not exceed 14.

## Write-Set Partitioning

Write-set coloring is owned by the Implementation-Manager. The CEO provides the file list and dependency graph; the Manager runs the coloring.

### Coloring Algorithm

1. Map each planned change to exact file paths.
2. Build interference graph: file A conflicts with file B if they share imports, a shared interface, or a dependency that both would change.
3. Greedy coloring: assign each file to the smallest available color (write set). Each color = one implementer worker.
4. Topological sort by dependency: if lane B needs lane A's output, lane B goes in the next wave.

### Granularity Floor

| Unit | Decision |
|------|----------|
| Less than 50 lines or single function | Do NOT spawn. Merge into nearest unit. |
| 50-200 lines, single file | Default worker unit. |
| More than 200 lines, single file with sections | May split into 2+ with line-range boundaries. |
| 2-5 related files | One worker per directory. |
| 6+ related files | Split by subdirectory or file role. |

### A2A Cost Filter

Applied by the Implementation-Manager before dispatching workers:

```
parallelismScore = (estimatedWorkTokens / injectionCostTokens) * independenceFactor

estimatedWorkTokens = fileCount * linesPerFile * 3 (tokens per line avg)
injectionCostTokens = 800 (dispatch pack + return synthesis)
independenceFactor = 1.0 (no deps), 0.3-0.7 (shared imports)

Spawn if:    parallelismScore >= 2.0 (clear win)
Maybe if:    1.0 <= parallelismScore < 2.0 (spawn if span slots remain)
Don't if:    parallelismScore < 1.0 (cost > benefit)
```

### Saturation Cap

Maximum 14 concurrent agents per wave (platform limit). Organized as:

```
1 CEO + up to 3 managers + up to 10 workers per wave

Breakdown flexibility:
  - 1 CEO + 1 Manager + up to 12 workers (narrow domain, high parallelism)
  - 1 CEO + 2 Managers + up to 10 workers (split review + implement)
  - 1 CEO + 3 Managers + up to 8 workers  (full three-tier, max span ~3)
```

If more candidates pass the cost filter than available slots, the Manager takes the top N by parallelismScore descending and serializes the remainder into the next wave.

**Concurrent manager constraint:** When multiple managers could theoretically run in parallel (disjoint domains, no dependency), prefer serial execution unless the project is L/XL scale and the efficiency gain is clear. Serial managers produce clearer handoff artifacts and fewer merge conflicts. The CEO decides based on domain independence.

## Context Management

- **Threshold lowered to ~70%** (not ~85%). Max parallelism consumes more context per wave due to worker injection costs.
- Dispatch context-master proactively after each wave if usage exceeds 70%.
- If context is saturated mid-wave, allow the active Manager to complete its worker batch, then serialize remaining waves.
- Managers carry their own context budget: worker dispatch packs must fit within the Manager's remaining context window. If a Manager cannot fit all workers, reduce span or split the domain into sub-waves.

## Closeout

Same as WF mode closeout, plus:
- Record the three-tier organization plan (managers assigned, spans used, wave breakdown) in task PLAN.md.
- Record parallelismScore breakdown per wave in task PLAN.md.
- context-master extracts parallelism-effectiveness patterns and three-tier overhead metrics.
- memory-master records what organizational structure worked for future task decomposition and span calibration.
- If a Manager synthesis step produced conflicts or gaps, memory-master records the pattern for future Manager instruction refinement.

## Difference from /wf

| Dimension | /wf | /wf max (Three-Tier) |
|-----------|-----|----------------------|
| Organization | Flat (controller + serial subagents) | Three-tier (CEO + Managers + Workers) |
| Exploration agents | 3-5 serial | 3-10 parallel via Exploration-Manager |
| Implementation | Serial (1 implementer) | Parallel waves via Implementation-Manager (3-7 workers) |
| Review | 1-2 serial gates | Parallel per dimension via Review-Manager (3-4 workers) |
| Architecture | Implicit in planning | Explicit wave via Architect-Manager (3 workers) |
| Write-set analysis | Implicit | Manager-owned coloring + cost model |
| Span calculation | Not defined | sqrt(files) with domain-type caps |
| Manager synthesis | Not applicable | 5-step protocol per manager |
| Concurrency cap | Not specified | 14 (1 CEO + up to 3 managers + up to 10 workers) |
| Communication model | O(n^2) flat | O(m + sum(s_i^2)) bounded |
| Context threshold | ~85% | ~70% |
| Granularity floor | Not defined | Less than 50 lines = don't split |
| Closeout agents | controller-led | context-master + memory-master (CEO-dispatched) |
