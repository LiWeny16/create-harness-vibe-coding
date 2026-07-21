# WF Max — Design Summary

## Overview

`/wf max` is a maximum-parallelism variant of `/wf` (WF mode). It splits tasks into minimal non-conflicting write-set units and dispatches as many subagents as possible in parallel waves, bounded by file-level write-set coloring and an explicit A2A cost model.

## Key Decisions

### 1. Coloring Algorithm for Write-Set Partitioning

Files are the unit of parallelism. Each planned change is mapped to its exact file paths. An interference graph is built: file A conflicts with file B if they share imports, a shared interface, or a dependency that both would change. A greedy coloring algorithm assigns each file to the smallest available color (write set). Each color becomes one parallel implementer lane. A topological sort by dependency places dependent lanes in later waves.

This is a well-understood polynomial-time algorithm (greedy coloring on an interval/conflict graph) that avoids the complexity of a full optimal-schedule solver while producing reasonable partitions for the common case of modular codebases.

### 2. Granularity Floor

Subagents have a minimum cost. Units below 50 lines or a single function are not spawned -- they are merged into the nearest larger unit. Units of 50-200 lines in a single file are the default. Files over 200 lines with clear sections may be split with line-range boundaries. Related files (2-5) are assigned to one subagent per directory; 6+ related files are split by subdirectory or file role.

This prevents the "thousand subagents for a hundred lines" anti-pattern while allowing genuine decomposition of large changes.

### 3. A2A (Agent-to-Agent) Cost Model

A quantitative filter decides whether to spawn a subagent:

```
parallelismScore = (estimatedWorkTokens / injectionCostTokens) * independenceFactor
```

- estimatedWorkTokens = fileCount * linesPerFile * 3
- injectionCostTokens = 800 (dispatch pack + return synthesis overhead)
- independenceFactor = 1.0 (no deps), 0.3-0.7 (shared imports)

Spawn thresholds: >= 2.0 is a clear win; 1.0-2.0 spawns only if slots remain; < 1.0 means cost exceeds benefit.

This prevents the controller from spending more tokens on coordination than on the actual work.

### 4. Saturation Cap: 14 Concurrent Agents

Maximum 14 concurrent agents per wave (16 minus 2 reserved for controller and integration). If more than 14 candidates pass the cost filter, the top 14 by parallelismScore descending are selected. This cap is derived from the practical limit of available subagent slots in current runtime environments.

### 5. Wave Dispatch Pattern

Implementation proceeds in waves:
- Wave 1: All independent implementers run in parallel with disjoint file_claims.
- Wave 1 Review: Parallel reviewers run per dimension (spec, code, security).
- Wave 2+: Dependent implementers whose output depends on Wave 1 run in the next wave, followed by review.
- Integration verification after all waves complete.

Each implementer receives a `Concurrency group` and `File claim` in the dispatch pack. The controller verifies no cross-agent file overlap after each wave.

### 6. Context Threshold Lowered to 70%

Standard WF mode dispatches context-master at ~85% context usage. For `/wf max`, the threshold is lowered to ~70% because max parallelism consumes more context per wave (more subagent returns to synthesize). This is a proactive early-warning adjustment.

### 7. Relationship to /wf

`/wf max` is a strict superset of `/wf` with additional constraints: explicit write-set coloring, A2A cost filtering, granularity floor, parallel review dimensions, and a lower context threshold. For tasks touching fewer than 3 files, `/wf` is preferred.

## Files Created

| File | Purpose |
|------|---------|
| `templates/common/.claude/commands/wf-max.md` | Slash command bridge (template) |
| `templates/common/.claude/skills/wf-max/SKILL.md` | Skill loader (template) |
| `templates/common/docs/harness/WF-MAX.md` | Full workflow doc (template) |
| `Harness/WF-MAX.md` | Dogfood runtime doc |
| `.claude/commands/wf-max.md` | Dogfood slash command bridge |
| `.claude/skills/wf-max/SKILL.md` | Dogfood skill loader |
| `Harness/tasks/wf-max/DESIGN.md` | This file |
| `Harness/tasks/wf-max/PROGRESS.md` | Task progress and heartbeat |
| `Harness/tasks/wf-max/PLAN.md` | Task implementation plan |
