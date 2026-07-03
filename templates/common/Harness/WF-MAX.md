# WF-MAX - Maximum Parallelism Workflow

**WF-MAX is a three-layer architecture: global mode (`wf-max`), agent role (`ceo|manager|worker|reviewer|verifier|reflector`), dispatch permission (`writeSet`, `forbidden`, `verification`). Global mode != every agent is CEO.**

```
CEO CONTRACT (top-level orchestrator only - Workers follow their dispatch packet):

ALLOWED first actions:
1. Read CLAUDE.md, Harness/MEMORY.md, Harness/README.md, Harness/WF-MAX.md
2. Create task PLAN/PROGRESS
3. Spawn W0 read-only agents in ONE message

FORBIDDEN before W0 returns:
- Read source files deeply (scoping only via Grep/Glob)
- Edit / Write / MultiEdit on source files - delegate to Workers with explicit writeSet
- Bash (except ls/dir/tree/git status/git diff)

FORBIDDEN always (unless writing PLAN.md/PROGRESS.md):
- Edit / Write / MultiEdit on source files - delegate to Workers with explicit writeSet

Workers: edit only files in dispatch.writeSet. Outside writeSet -> blocked.
Managers: scope, coordinate. No source edits. Reviewers: read only.

If tempted to Read/Edit/Bash a source file -> STOP. Spawn a Worker.
```

WF-MAX is the maximum-parallelism extension of WF. It is a strict superset: it
inherits the complete WF role chain and all acceptance gates, then expands each
phase through CEO -> Manager -> Worker fan-out. The required chain is:
Mini PRD -> Acceptance Criteria -> UI/API Contracts -> Test Plan ->
Implementation Dispatch -> Independent Validation -> Cross-Review ->
Debug/iterate if needed -> verifier evidence -> Cross-Review ->
Reflector PASS -> Final Acceptance -> Memory.
The hierarchy changes; the source of truth does not. PRD-derived AC IDs govern
every worker dispatch, test, review, validation result, debug handoff,
reflection verdict, and memory entry. See
[ACCEPTANCE_PROTOCOL.md](ACCEPTANCE_PROTOCOL.md),
[AGENT_ISOLATION.md](AGENT_ISOLATION.md), and [HARNESS_BRIDGE.md](HARNESS_BRIDGE.md).

## Trigger

- Explicit: `/wf-max [task]`
- Auto: WF task with write-set >=5 files AND clear disjoint boundaries
- parallelismScore = (files * avgLines * 3 / 800) * independenceFactor
  - spawn >=2.0 | maybe 1.0-2.0 | skip <1.0 (degrade to /wf)

## Explicit Invocation Is an Absolute Fan-Out Mandate

When the user types `/wf-max` (or `wf max`), spawning subagents is **mandatory and unconditional**. File count, task size, line count, and overhead estimates DO NOT apply to explicit invocation - they govern ONLY auto-triggering (whether the harness enters wf-max on its own). A 1-file task invoked with `/wf-max` still fans out to parallel subagents.

WF-MAX uses cross-CLI overflow for maximum fan-out: use the current runtime
subagent pool first; when it reaches a practical limit, spawn the other CLI with
explicit dispatch packets (Codex -> `claude -p`, Claude -> available Codex CLI
such as `codex exec`). Only use bounded-pass fallback when neither runtime
subagents nor cross-CLI overflow are available.

### Runtime Thread Budget And Overflow

WF-MAX removes the Harness default agent-count cap, not the runtime's real
limits. Before a large fan-out wave, the CEO records the active runtime budget:

- Codex: inspect known config surfaces when available, especially
  `agents.max_threads` and `agents.max_depth` in Codex config. Generated
  Harness projects set `.codex/config.toml` to `max_threads = 12` and
  `max_depth = 1` by default. Codex's unset default may be lower than the
  planned wave.
- Claude: use the available subagent/task limit reported by the current
  runtime.
- Billing, rate limits, local resources, and organization policy still apply.

Overflow order:

1. Use the current runtime's native subagents up to the configured safe budget.
2. Close completed agents before treating the pool as exhausted.
3. If more independent work remains, overflow to the other CLI with explicit
   dispatch packets (`claude -p` or `codex exec`).
4. If Codex remains bottlenecked and additional native Codex parallelism would
   materially help, ask the user before raising `agents.max_threads` above the
   scaffold default. Offer a concrete value and tradeoff. Do not silently edit
   project or global Codex config.
5. Keep `agents.max_depth = 1` unless the user explicitly approves recursive
   delegation; deeper nesting can multiply fan-out, token use, latency, and
   local resource pressure.
6. If both runtimes are unavailable or exhausted, use bounded role passes and
   record the fallback in the task PLAN.

Do not rely on forked conversations, derived threads, undocumented config,
environment variables, Codex++, local patches, or third-party forks as stable
capacity. Treat them as experimental at best and unsafe for required WF-MAX
behavior.

"Degrade to /wf" changes the **organization** (flat vs CEO/Manager/Worker), never the **complete WF role chain**. `/wf` itself requires plan, research/docs research as needed, architecture, test, implement, independent validation, cross-review, reflector, and final acceptance. There is no path from an explicitly typed command to a solo main-thread pass. If you find yourself reading source files and editing them directly after the user typed `/wf-max`, you have violated this mandate: stop and dispatch.

## Companion Docs

- [subagents.md](subagents.md) - agent roster, controller role, efficiency ladder
- [dispatch.md](dispatch.md) - handoff format, File claim, Concurrency group fields
- [agent-workflow.md](agent-workflow.md) - build/test/review loop, cohesion rule, completion gate

## Organization Model

```
CEO(1) -> Manager_1(span) -> Worker_1..n
       -> Manager_2(span) -> Sub-Manager(span) -> Worker_1..n [depth >=3]
       -> Manager_3(span) -> Worker_1..n
```

- CEO: intent, scope, integration, final verification. Direct reports 3-5 Managers. **CEO never writes code directly** - dispatch Workers for all file changes. CEO only synthesizes results and decides next waves.
- Manager: domain partition -> parallel dispatch -> synthesize -> report. Serial across domains; parallel within domain. **Manager agents must be defined by the project** (not shipped by the harness) - create them under `.claude/agents/` with the `Agent` tool enabled for nested spawning.
- Worker: single file per write Worker (implementer, one file_claim). Single dimension/topic per read Worker (reviewer, researcher). File claims must be file-level disjoint. Topic-level splitting within a single file is only allowed for read-only Workers.
- depth >=3: Manager spawns Sub-Manager (span <=7) instead of Worker. Recursive until leaf condition met.

## Decomposition Gate (MANDATORY - CEO-level, before ANY Worker dispatch)

The Decomposition Gate is a hard stop. No code changes, no Worker spawns until the gate passes. The CEO MUST produce a Dispatch Table artifact and pass the Self-Audit Checklist. This is the single most important enforcement mechanism in WF-MAX - it exists because **models default to "do it myself" rather than "decompose and delegate."**

### Gate Artifact: Dispatch Table

WF-MAX gate order:

```text
PRD-GATE
-> AC-GATE
-> CONTRACT-GATE
-> TEST-GATE
-> D-GATE
-> IMPLEMENT-GATE
-> VALIDATION-GATE
-> REVIEW-GATE
-> REFLECT-GATE
```

D-GATE answers "who may change which file." The earlier gates answer "what must
be accepted, how it will be tested, and which truth files are forbidden to
implementers." The Dispatch Table must map each write Worker to the AC IDs it
implements.

CEO MUST write this table in the task PLAN.md after W1 architecture defines the write-set and before W2 implementation dispatch:

```
| File | Concern | Worker Type | Worker Label | Read-Only? |
|------|---------|------------|--------------|------------|
| src/a.ts | Auth middleware | implementer | impl-auth | No |
| src/b.ts | DB schema | implementer | impl-db | No |
| docs/arch.md | Research existing patterns | researcher | res-arch | Yes |
```

For acceptance-driven work, add an `AC IDs` column to this table and list every
criterion the Worker is allowed to satisfy.

### Gate Rules (any violation = gate fail, retry)

Acceptance-specific gate rules:

1. PRD, AC, UI/API contracts, and test plan must exist before implementation dispatch.
2. Every write Worker row must cite AC IDs.
3. Implementer forbidden set must include PRD, AC, UI/API contracts, test plan, and validation report unless an approved Change Request is recorded.

1. **Every file in the write-set MUST have exactly one write Worker.** Unassigned files = fail. This is the anti-bundling rule - one Worker touching >1 write file = fail. (Read Workers may span multiple files.)
2. **Manager count MUST be at least `Manager_min`.** This is the anti-under-decomposition rule at the domain level. Fewer than the minimum number of Managers means domains are too coarse. "One Manager can handle everything" is NOT valid in WF-MAX - if the task were that simple, degrade to /wf.
3. **Each write Manager MUST have 2-7 write Workers, except XS explicit `/wf-max` where a one-file write set may use one write Worker plus separate read/review/verify/reflect roles.** Read-only review/research Managers use the domain caps below. 0-1 unsupported Workers = Phantom Manager -> dissolve. > cap = Manager context is overloaded -> split the domain and add a Manager.
4. **CEO MUST NOT appear as a Worker row.** CEO writes no production code - fail.

### CEO Tool Boundary

The CEO operates under a strict tool restriction model for production code:

| CEO Has | CEO MUST NOT Use (on source code) |
|---------|-----------------------------------|
| Task (spawn agents) | Edit (on source files) |
| Read (for scoping) | Write (on source files) |
| TodoWrite (tracking) | Bash (except final verification) |
| Grep/Glob (for scoping) | MultiEdit (on source files) |

**Exception**: CEO MAY write to `Harness/tasks/<id>/PLAN.md` and `Harness/tasks/<id>/PROGRESS.md` - these are task-tracking artifacts, not production code. The Dispatch Table, Self-Audit Checklist, and synthesis reports are the CEO's primary durable artifacts.

If the CEO finds itself reaching for Edit/Write/Bash on source files, it is violating role boundaries. Stop. Delegate to a Worker.

### Self-Audit Checklist

After producing the Dispatch Table, CEO MUST answer all before proceeding:

- [ ] Do PRD, AC, contracts, and test plan exist before implementation dispatch?
- [ ] Does every implementation Worker row cite AC IDs?
- [ ] Are truth files excluded from implementer write sets unless Change Request is approved?

- [ ] Did I assign myself any source file? (must be **No** - PLAN.md/PROGRESS.md writes are the exception)
- [ ] Is every file with planned changes assigned to exactly one write Worker? (must be **Yes**)
- [ ] Does any Worker have >1 write file? (must be **No**)
- [ ] Is Manager count >= `Manager_min`? (must be **Yes**, or justification written)
- [ ] Does every Manager have 2-7 Workers? (<2 = Phantom Manager, >7 = overloaded)
- [ ] Are there files >200 lines or with >1 concern that should be split into separate files?
- [ ] Could any serial chain be parallelized? (different files with no shared imports = parallelize)
- [ ] Will all Workers be spawned in ONE message?

Gate retries until all checks pass. **CEO may NOT proceed to W2 implementation dispatch with a failing gate.**

## Anti-Pattern Catalog

Before every wave dispatch, CEO MUST scan for these patterns. **Any match = stop and re-decompose.**

| # | Anti-Pattern | Symptom | Detection | Fix |
|---|-------------|---------|-----------|-----|
| AP1 | **CEO-as-Worker** | CEO assigns itself a file or starts writing code | CEO in Dispatch Table; Edit/Write/Bash used by CEO | Re-delegate to a Worker immediately |
| AP2 | **Under-decomposition** | Fewer Workers than `ceil(sqrt(files))` | Count check fails; "1-2 agents is enough for this" | Split files by concern, module, or layer |
| AP3 | **Serialization trap** | "Let me do X first, then I'll know how to dispatch Y" | Sequential plan without parallel candidates | Dispatch X and Y in parallel NOW; Worker-X returns spec that Worker-Y consumes |
| AP4 | **Fake parallelism** | Multiple Workers assigned same file | Duplicate file path in Dispatch Table | One file = one Writer. Split file into separate modules, or serialize |
| AP5 | **Phantom Manager** | Manager spawns 0-1 Workers | Manager's sub-table has <2 Workers | Dissolve Manager; CEO or sibling absorbs domain |
| AP6 | **Sequential spawn** | Workers spawned one-per-turn instead of batched | Only 1 Task() call per message | Batch ALL Task() calls into ONE message |
| AP7 | **Silent degrade** | CEO switches to /wf without recording reason | No Dispatch Table; flat agent spawns | Explicit decision + justification in PLAN.md; only valid reason is overhead > 0.30 |

## Span Formula (Prescriptive Floor)

```
Manager_min = max(1, ceil(write_files / 7), ceil(sqrt(write_files) / 2))  # hard floor for write decomposition
Manager_max = min(max(Manager_min * 2, Manager_min), 7)                    # per-wave; exceed only with written justification
Write_worker_max_per_manager = 7                                           # hard cap for write Managers; split domain if exceeded

Worker count per wave = write_files (one Worker per write file, guaranteed by Gate Rule #1)

Domain caps (workers per Manager by type):
  Architecture:    cap = 3
  Implementation:  write cap = 7
  Review:          read-only cap = 10
  Research:        read-only cap = 12
```

**Manager_min is a floor, not a target.** The span formula prevents domain-level under-decomposition - the real failure mode where one Manager tries to coordinate too many Workers across unrelated concerns. Worker-level under-decomposition is prevented by Gate Rule #1 (one file per Worker).

## Total Agents (recursive, scales to 1000)

```
total(depth, span) = sum(span^L) for L=0..depth
```

- depth=0: CEO + Workers only (XS)
- depth=1: CEO + Managers + Workers
- depth=2: CEO + Managers + Workers
- depth>=3: CEO + Managers + Sub-Managers + Workers (recursive)
- no Harness hard cap; runtime thread budgets, config, billing, and local
  resources still cap actual concurrency

## Sizing Table

| Scale | Files   | Depth | CEO | Mgrs | Workers | Total |
|-------|---------|-------|-----|------|---------|-------|
| XS    | 1-4     | 0     | 1   | 0    | 1-3     | 2-4   |
| S     | 5-12    | 1     | 1   | 2    | 6       | 9     |
| M     | 13-30   | 1     | 1   | 3    | 15      | 19    |
| L     | 31-60   | 2     | 1   | 5    | 35      | 41    |
| XL    | 61-200  | 2     | 1   | 7    | 49      | 57    |
| XXL   | 201-500 | 3     | 1   | 7    | 343     | 351   |
| XXXL  | 501-1000| 3     | 1   | 7    | 686     | 694   |

- depth>=3: Managers spawn Sub-Managers (span<=7). No mixed Worker+Sub-Manager dispatch in same wave.

## Leaf Condition (stop splitting)

- files <= span*2
- OR avgLines < 50
- OR overhead > 0.30 (degrade to /wf)

## Manager Types (4)

| Type          | Trigger                       | Span | Worker Roles                                                  |
|---------------|-------------------------------|------|---------------------------------------------------------------|
| Architect-Mgr | cross-file interfaces, new ports | 3  | boundary-researcher, interface-designer, data-flow-mapper     |
| Implement-Mgr | write-set defined             | 5-7  | implementer_1..n (1 file_claim each)                         |
| Review-Mgr    | implementation wave complete  | 3-4  | reviewer-spec, reviewer-code, reviewer-security               |
| Explore-Mgr   | L+ project, uncertain scope   | 5-10 | researcher_1..n, domain-explorer_1..n                         |

## Manager Synthesis Protocol

```
1. COLLECT      -> await all Worker returns
2. DEDUPLICATE  -> dedupe, merge overlap
3. CONFLICT     -> flag contradictions (file_claim overlap, interface mismatch); no silent resolve
4. SYNTHESIZE   -> single integrated artifact
5. REPORT       -> CEO-actionable synthesis + raw Worker returns (audit)
```

- Worker failure: retry 1x -> on 2nd failure, Manager absorbs or escalates to CEO for replan.

## Wave Orchestration

WF-MAX expands `/wf` by turning each acceptance phase into a manager/worker
wave while preserving the complete WF role chain:

```text
Product Manager Group -> PRD-GATE
Acceptance Manager -> AC-GATE
Contract Manager -> CONTRACT-GATE
Test Manager -> TEST-GATE
Architecture Manager -> boundary/interface contract
Implementation Manager -> AC-mapped D-GATE and write-set coloring
Validation Manager -> E2E/screenshot/trace/contract validation matrix
Review Manager -> spec/code/test/UX/security review
Reflection Manager -> reflector verdict and unresolved-risk synthesis
Debug Manager -> AC failure root-cause loop
Memory Master -> durable lessons
```

```
W0:    Explore-Mgr    -> N parallel researchers -> synthesize -> CEO
E-GATE:               -> Exploration Gate: CEO verifies all exploration questions answered, findings synthesized (lightweight; see WF.md Decomposition Gate)
W1:    Architect-Mgr  -> 3 parallel -> boundary decisions + interface contract -> CEO approval
D-GATE:               -> Write Decomposition Gate: CEO produces Dispatch Table + Self-Audit -> GATE PASS/FAIL (MANDATORY, applied to the write-set defined by architecture)
W2:    Implement-Mgr  -> write-set coloring -> wave dispatch: ALL Workers spawned in ONE message -> merge -> CEO
W2R:   Review-Mgr     -> 3-4 parallel reviewers -> dedupe + severity -> CEO assigns fixes
W3+:   Dependent waves (repeat W2 pattern; re-run D-GATE if write-set changed significantly)
VALIDATION: CEO -> verifier -> AC evidence matrix -> cross-review
REFLECT:    CEO -> reflector -> PASS/RETURN_TO_DEBUG/BLOCKED
CLOSEOUT:   CEO -> final acceptance -> context-master + memory-master (direct, no Manager)
```

- **E-GATE** (Exploration Gate): read-only agents each had a specific question; all returns are synthesized into PLAN.md. No exploration blind spots.
- **D-GATE** (Write Decomposition Gate): applies AFTER architecture defines the write-set, BEFORE any implementation Worker spawns. Dispatch Table covers the actual write-set. Gate is non-negotiable.
- W2 dispatch: ALL Workers for a wave MUST be spawned in a single message - not one per turn. Batching is what makes parallelism real.

- Acceptance gates apply before D-GATE. D-GATE decomposes the write set; it does not define the acceptance truth.
- Cross-review and reflector PASS are required before final acceptance.
- Wave scheduling: Managers serial across domains, Workers parallel within domain.
- CEO validates wave output before starting next wave. No pipelining.

## Overhead & Cost Filter

```
overhead(depth) = 0.10 (depth<=2) | 0.20 (depth=3) | 0.35 (depth>=4)
```

- overhead > 0.30 -> degrade to /wf complete role chain
- independenceFactor: 1.0 (no deps) | 0.3-0.7 (shared imports)

## When NOT to use /wf-max

These conditions govern **auto-trigger degradation only** (wf-max -> /wf). They never apply when the user explicitly types `/wf-max`, and "degrade" always means the flat /wf complete role chain, never a solo pass.

- files < 5 -> use /wf complete role chain
- all changes share single interface -> serial dependency
- import/re-export refactor -> global consistency required
- communication overhead > 30% -> degrade to /wf complete role chain

## /wf vs /wf-max

Both modes use the same acceptance-driven mother flow. `/wf-max` changes the
organization and amount of parallelism, not the PRD-derived source of truth.

| Dimension        | /wf              | /wf-max                          |
|------------------|------------------|----------------------------------|
| Organization     | flat complete role chain | CEO -> Manager -> Worker hierarchy |
| Exploration      | planner/research/docs/architect roles | manager-led max-parallel exploration |
| Implementation   | bounded implementer lane | manager-led N parallel workers (span 5-7) |
| Review           | 2+ independent review lenses | manager-led parallel spec/code/test/security lenses |
| Reflection       | reflector required before acceptance | reflector required before acceptance |
| Span formula     | none             | sqrt(files) + domain cap         |
| Recursive depth  | 0                | 1-3; overflow can use `claude -p` or `codex exec` manager/worker processes |
| Context threshold| ~85%             | ~70%                             |
| Granularity floor| none             | <50 lines -> no split            |
