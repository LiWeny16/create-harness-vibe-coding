---
name: wf-max
description: Use for /wf max or maximum parallelism. Three-tier CEO→Manager→Worker hierarchy with recursive depth, per-domain span caps, and leaf-condition stop rules.
---

# WF Max

CEO → Managers → Workers. Scale to 1000 agents via recursive depth. Full spec: `Harness/WF-MAX.md`.

## Load

- `Harness/WF-MAX.md` — organization model, span formula, wave orchestration
- `Harness/subagents.md` — agent roster, controller role
- `Harness/dispatch.md` — File claim, Concurrency group handoff fields
- `Harness/agent-workflow.md` — cohesion rule (feature doc < Worker granularity)

## Organization

```
CEO(1) → Managers(span) → Workers(leaf) or Sub-Managers(depth≥3)
```

- CEO: intent, scope, integration, final verification.
- Manager: domain partition → parallel dispatch → synthesize → report.
- Worker: single file (write) or single dimension (read). File claims must be file-level disjoint.
- depth≥3: Manager spawns Sub-Manager (span≤7). No mixed Worker+Sub-Manager in same wave.

## Span Formula

```
span = min(ceil(sqrt(files)), domain_cap)
  Architecture:   3
  Implementation: 5-7
  Review:         7-10
  Research:       10-12
```

## Total Agents

```
total(depth, span) = Σ span^L for L=0..depth
```

No hard cap. Governed by leaf condition + overhead filter.

## Leaf Condition

```
stop if: files ≤ span×2 | avgLines < 50 | overhead > 0.30
```

Overhead threshold: `overhead > 0.30 → degrade to /wf`

## Manager Types (4)

| Type | Span | Workers |
|------|------|---------|
| Explore-Mgr | 5-10 | researcher₁..ₙ, domain-explorer₁..ₙ |
| Architect-Mgr | 3 | boundary-researcher, interface-designer, data-flow-mapper |
| Implement-Mgr | 5-7 | implementer₁..ₙ (1 file_claim/Worker) |
| Review-Mgr | 3-4 | reviewer-spec, reviewer-code, reviewer-security |

## Manager Synthesis

```
1. COLLECT → 2. DEDUPLICATE → 3. CONFLICT (flag, no silent resolve) → 4. SYNTHESIZE → 5. REPORT
```
Worker failure: retry 1× → absorb or escalate to CEO.

## Wave Orchestration

```
W0: Explore-Mgr → N parallel → synthesize → CEO
W1: Architect-Mgr → 3 parallel → boundary contract → CEO approval
W2: Implement-Mgr → write-set coloring → wave dispatch: N parallel → merge → CEO
W2R: Review-Mgr → 3-4 parallel → dedupe+severity → CEO assigns fixes
W3+: Dependent waves (repeat W2)
CLOSEOUT: CEO → context-master + memory-master (direct)
```

## When NOT to Use

- files <5 → /wf
- all changes share single interface → serial
- overhead > 30% → degrade

## /wf vs /wf-max

| | /wf | /wf-max |
|---|-----|------|
| Organization | flat | CEO→Mgr→Worker (3-tier) |
| Span formula | none | sqrt(files) + domain cap |
| Recursive depth | 0 | 1-3 (scales to 1000) |
| Granularity floor | none | <50 lines no split |
| Context threshold | ~85% | ~70% |
