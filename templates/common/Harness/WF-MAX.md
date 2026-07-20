# WF-MAX — Maximum Safe Parallelism

`/wf-max` = `/wf` kernel + maximum safe fan-out. It is NOT a separate workflow. It is a parallelism superset of `/wf` and inherits the full [WF-KERNEL.md](WF-KERNEL.md) orchestration engine and [WF.md](WF.md) tier contract, then expands execution through a three-layer architecture (CEO → Manager → Worker) with dispatch permissions (writeSet, forbidden, verification). Global mode != every agent is CEO.

WF-MAX is **explicit only**. Enter ONLY when the user explicitly types `/wf-max`, `$wf-max`, or `/skills wf-max`.

## Delta from /wf

| Dimension | /wf | /wf-max |
|---|---|---|
| Orchestration | Ready-queue, tier-gated | Same ready-queue + max decomposition |
| Exploration | codebase-explorer fan-out | explore-manager → 5-10 researchers |
| Architecture | architect (when triggered) | architect-manager → 3 architects |
| Implementation | One implementer per wave | implement-manager → 5-7 implementers (one file_claim each) |
| Review | Reviewer(s) per wave | review-manager → 3-4 parallel reviewers |
| State | Controller or task-scribe | task-scribe continuously maintains dispatch ledger |
| Source edits | Implementer writes | Workers write ONLY dispatch.writeSet; CEO never writes source |

## Fan-Out Modes

**WF-Max-Useful** (default): fan-out only where writeSets or review lenses are meaningfully independent. Overhead > 0.30 degrades a wave to flat role pass. CEO uses D-GATE but Manager/Worker fan-out is gated by actual independence.

**WF-Max-Strict** (explicit `--strict`, `strict wf-max`, or `strict mode`): unconditional fan-out per span formula. Every file gets a Worker.

## CEO Contract

CEO reads, plans, dispatches, synthesizes, and writes task state only.
- **CEO never writes production source code.** All source edits are delegated to Workers.
- CEO may spawn task-scribe (haiku) to maintain dispatch ledger and heartbeat.
- CEO may spawn codebase-explorer(s) (haiku) for scoped source discovery.

## Parallelism Priority

1. Read-only exploration — max parallel, all readSets
2. Docs/research — max parallel
3. Test design — max parallel
4. Implementation — parallel only when writeSets are DISJOINT
5. WriteSet conflicts → sequential wave, patch-only return, or worktree/branch isolation
6. Review — parallel per-wave when verifier evidence is ready
7. Idle capacity → immediately dispatch next ready item from queue

## Span Formula (WF-Max-Strict)

```
Manager_min = max(1, ceil(write_files / 7), ceil(sqrt(write_files) / 2))
Manager_max = min(max(Manager_min * 2, Manager_min), 7)
```

## Worker Discipline

- One file_claim per write Worker
- WriteSet must be disjoint across parallel Workers
- Workers return <=250 tokens + evidence/file paths
- task-scribe (haiku) runs alongside any wave

## Token Budget and Fan-Out Caps

WF-MAX fan-out is bounded. Unbounded worker dispatch is forbidden.

- **Total worker cap**: Maximum 15 agents per WF-MAX task (all waves combined). Managers, reviewers, and verifiers count toward this cap. Read-only scouts and task-scribe do not count.
- **Per-wave cap**: Maximum 7 Workers per implementation wave (enforced by implement-manager span formula).
- **Reviewer cap**: Maximum 4 reviewers per wave (review-manager).
- **Manager cap**: Maximum 4 Managers total (explore, architect, implement, review).
- **Token budget**: If `budget.total` is set (user-specified budget), CEO MUST reserve >=30% for review/verify/reflect phases. Stop dispatching Workers when remaining budget is below 50k tokens.
- **Overflow discipline**: Cross-CLI overflow (Codex → Claude, Claude → Codex) is allowed only after native subagent pool is genuinely exhausted (not just busy). Each overflow dispatch costs context; prefer closing completed agents first.
- **Idle workers**: Close completed agents before declaring the pool exhausted. Do not spawn new workers while idle capacity is available.

## Organization Model

```
CEO(1) -> Manager_1(span) -> Worker_1..n
       -> Manager_2(span) -> Sub-Manager(span) -> Worker_1..n
```

## D-GATE

D-GATE is mandatory before implementation waves per [WF-KERNEL.md](WF-KERNEL.md) dispatch packet format: dispatch table, AC IDs, disjoint file claims, self-audit, reviewer plan. CEO may NOT proceed to W2 implementation dispatch with a failing gate.

## Overflow

1. Current runtime subagents first.
2. Close completed agents; fill idle slots immediately.
3. Cross-CLI overflow: use an available peer CLI with explicit dispatch packets: `claude -p`, `codex exec`, or `opencode run --agent <role> --dir .`.
4. Bounded-pass fallback only when subagents and overflow are exhausted.
5. Generated Codex config defaults to `agents.max_threads = 12` and `agents.max_depth = 1`. Ask the user before raising `agents.max_threads` above that default. Keep `max_depth = 1` unless recursive delegation is explicitly approved.
6. Do not rely on Codex++, undocumented config, environment variables, forked/derived conversations, or third-party forks as stable capacity.

## Anti-Patterns and Sizing

See original [WF-MAX.md](WF-MAX.md) anti-pattern catalog (AP1-AP7) and sizing table (XS-XXXL). These apply under WF-Max-Strict and serve as reference for WF-Max-Useful decomposition.
