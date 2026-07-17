---
name: subagent-orchestrator
description: Use when work needs bounded subagent coordination, parallel read-only exploration, independent review gates, broad context partitioning, or controlled handoffs.
---

# Subagent Orchestrator

This skill is runtime-neutral. Claude Code and Codex expose different
subagent surfaces; follow the same Harness role contract either way.

## Memory Preflight

1. Direct simple tasks and `/wf-help` are exempt.
2. For non-direct work, load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md` before planning, dispatch, edits/deletes, validation, or peer review.
3. Load `Harness/memory/*` only when `MEMORY_PROTOCOL.md` scenario hints match; otherwise record "memory hints: none".

## Load

- `Harness/subagents.md`
- `Harness/dispatch.md`
- `Harness/context-loading.md`
- `Harness/agent-workflow.md`
- `Harness/PROGRESS.md`
- Active `Harness/tasks/<task-id>/PROGRESS.md` and `PLAN.md`, when present
- `Harness/WF.md` when in explicit `/wf`, `$wf`, or `/skills wf`

## Runtime Mapping

- Claude Code: use the `.claude/agents/` role roster and the available
  subagent/task tool.
- Codex: use the available subagent tool or role mechanism in the current
  surface. If unavailable, emulate the same roles as separate bounded passes.
- WF-MAX cross-CLI overflow: prefer the current runtime's subagents first; if that pool
  is exhausted, overflow to the other CLI with explicit dispatch packets
  (Codex -> `claude -p`, Claude -> available Codex CLI such as `codex exec`)
  before bounded-pass fallback.
- In every runtime, record fallback and role coverage in the task plan.

## Rules

- The main agent is the controller. It decomposes work, writes task state,
  integrates returns, and owns final verification.
- Subagents or bounded passes are readers and reporters unless a write set is
  explicitly assigned and disjoint.
- Explicit WF/WF-MAX requires tier-specific role coverage per `Harness/WF.md`.
- Every dispatch needs role, goal, mode, read set, write set, forbidden scope,
  injected docs, dependencies, evidence, stop condition, and return format.
- Prefer parallel read-only exploration first. Serialize writers unless write
  sets are disjoint and isolated.
- After implementation, run independent spec/AC and code/architecture/test
  review gates. Final acceptance is blocked until cross-review passes and the
  reflector returns PASS.

## Return

Report roles or bounded passes used, dispatch table status, accepted/rejected
findings, conflicts, decisions, commands, evidence, and remaining risks.
