---
name: wf-max
description: Use for /wf-max in Claude Code, $wf-max or /skills wf-max in Codex, or maximum-parallelism Harness work with WF strict-superset gates and CEO -> manager -> worker decomposition.
---

# WF-MAX Adapter

The authoritative workflow lives in `Harness/WF-MAX.md`; this adapter only
routes and summarizes hard constraints.

## Invocation

- Claude Code: `/wf-max [task]`
- Codex: `$wf-max` or `/skills` then choose `wf-max`

## Load

1. `CLAUDE.md`
2. `Harness/MEMORY.md`
3. `Harness/README.md`
4. `Harness/WF-MAX.md`
5. `Harness/subagents.md`
6. `Harness/dispatch.md`
7. `Harness/agent-workflow.md`

## Rules

WF-MAX is a WF strict superset: every WF role, gate, and acceptance rule still
applies, then execution expands through:

1. Global mode: `wf-max`
2. Agent role: `ceo | manager | worker | reviewer | verifier | reflector`
3. Dispatch permission: `writeSet`, `forbidden`, `verification`

- CEO reads, plans, dispatches, synthesizes, and writes task state only. CEO
  never edits production source.
- Workers edit only the dispatch `writeSet`; outside write set is blocked.
- Managers coordinate and synthesize. Reviewers read/report only.
- D-GATE is mandatory before implementation waves: dispatch table, AC IDs,
  disjoint file claims, self-audit, and reviewer plan.
- Final acceptance requires verifier evidence, cross-review, and reflector PASS.

## Fan-Out Discipline

- Use as many useful subagents as the runtime safely allows.
- Codex capacity may be configured through official `agents.max_threads` and
  `agents.max_depth`; generated Harness config defaults to
  `.codex/config.toml` with `max_threads = 12` and `max_depth = 1`.
- Close completed agents before declaring the pool exhausted.
- If Codex remains bottlenecked, ask the user before raising
  `agents.max_threads` above the scaffold default. Do not silently edit project
  or global Codex config.
- Keep `agents.max_depth = 1` unless the user explicitly approves recursive
  delegation.
- If the current runtime is exhausted, overflow to the other CLI with explicit
  dispatch packets: Codex -> `claude -p`; Claude -> available Codex CLI such as
  `codex exec`.
- Do not rely on undocumented config, environment variables, forked/derived
  conversations, Codex++, local patches, or third-party forks as stable ways to
  remove subagent limits.
- Fall back to bounded role passes only when native subagents and cross-CLI
  overflow are unavailable; record the fallback in the task PLAN.
