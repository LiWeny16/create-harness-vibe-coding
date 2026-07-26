---
description: Run WF-MAX with mandatory subagent fan-out and recorded degradation
---

# /wf-max

This is a **workflow command**, not a direct command. Do not execute it as a
static help or script command.

1. Load `CLAUDE.md`, `Harness/MEMORY.md` (index only per Memory Preflight), then `Harness/README.md`.
2. Load and follow `.claude/skills/wf-max/SKILL.md` (mirror: `.agents/skills/wf-max/SKILL.md`) and `Harness/specs/workflows/WF-MAX.md`.
3. Preserve cache-first order per `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`.
4. MUST attempt native runtime subagent fan-out before planning is considered complete:
   - start `task-scribe` when available for task ledger/state;
   - start W0 exploration through manager/explorer/researcher roles with disjoint read sets;
   - when running in OpenCode, require project `opencode.json` to have `subagent_depth >= 2` and manager agents to have `permission.task` allowlists for manager -> worker fan-out;
   - if nested manager fan-out is unavailable, dispatch leaf workers directly from the primary agent with exact WF-MAX dispatch packets.
5. In every runtime, MUST attempt native subagent fan-out before implementation planning is considered complete; never silently continue as a solo controller.
6. If native fan-out fails, record `fanoutAttempted: true`, runtime, channel tried, agents requested, failure/degradation reason, and the fallback path in `Harness/tasks/<task-id>/PLAN.md` or `PROGRESS.md`.
7. Continue with WF-Max-Useful by default or WF-Max-Strict only when the user explicitly requests strict mode.
