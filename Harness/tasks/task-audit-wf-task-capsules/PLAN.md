# task-audit-wf-task-capsules - PLAN

Compact task record. Keep only facts needed to resume, review, and verify.
Link files or command names instead of pasting logs or subagent transcripts.

> Task ID: task-audit-wf-task-capsules

## Goal

- Outcome: Audit and improve the WF task-capsule contract around explicit `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, and `/skills wf-max` triggers; review `wf-review` peer CLI prompt/output reliability; define multi-open task, dependency, parallel queue, and resume semantics; design atomic task commands such as `/wf-task-record`, `/wf-task-list`, and `/wf-task-archive`.
- Non-goals: Do not commit, push, publish, or touch unrelated product/source work.

## Decisions

- Create this task capsule now because the user explicitly requested a new task.
- Keep implementation paused after capsule creation.
- Treat manual WF command or skill invocation as the intended capsule-mode entry signal to audit.
- Reuse this active audit task instead of creating a duplicate task for multi-open/dependency/resume-state gaps.
- Prepare this capsule as a Claude Code handoff. This turn does not implement framework edits; Claude Code may implement after the user invokes the handoff prompt.

## Acceptance

- AC-001: The audit identifies whether WF trigger timing is explicit and whether task capsule creation is mandatory for `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, and `/skills wf-max`.
- AC-002: The audit explains why `wf-review` peer CLI calls such as `claude -p` and `opencode run` can fail through truncation, prompt transport, JSON/output schema drift, timeout, auth, or tool/runtime differences, with evidence from current docs/probes.
- AC-003: The proposed design defines atomic task commands or skills for `/wf-task-record`, `/wf-task-list`, and `/wf-task-archive`, including how they interact with existing tasks and when they create or avoid capsules.
- AC-004: The proposed design defines whether Harness supports multiple open tasks, cross-task chain dependencies, per-task parallel work queues, and deterministic resume from `continue` in a fresh agent context.

## Scope

Allowed write set:
- Harness task-state files for `task-audit-wf-task-capsules`
- Root runtime docs: `CLAUDE.md`, `Harness/README.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/workflows/WF-MAX.md`, `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/workflows/WF-STATE.md`, `Harness/specs/runtime/dispatch.md`, `Harness/specs/runtime/subagents.md`
- Template runtime docs: matching files under `templates/common/`
- Task CLI: `Harness/scripts/task-state.mjs`, `templates/common/Harness/scripts/task-state.mjs`
- Task commands/skills: `.claude/commands/wf-task-record.md`, `.claude/commands/wf-task-list.md`, `.claude/commands/wf-task-archive.md`, `.opencode/commands/wf-task-record.md`, `.opencode/commands/wf-task-list.md`, `.opencode/commands/wf-task-archive.md`, `.claude/skills/wf-task-record/SKILL.md`, `.claude/skills/wf-task-list/SKILL.md`, `.claude/skills/wf-task-archive/SKILL.md`, `.agents/skills/wf-task-record/SKILL.md`, `.agents/skills/wf-task-list/SKILL.md`, `.agents/skills/wf-task-archive/SKILL.md`, and matching `templates/common/.claude/...` sources
- WF skills: `.claude/skills/wf/SKILL.md`, `.agents/skills/wf/SKILL.md`, `.claude/skills/wf-max/SKILL.md`, `.agents/skills/wf-max/SKILL.md`, `.claude/skills/wf-review/SKILL.md`, `.agents/skills/wf-review/SKILL.md`, `.claude/skills/wf-agents-docs/SKILL.md`, `.agents/skills/wf-agents-docs/SKILL.md`, and matching `templates/common/.claude/skills/...` sources
- OpenCode agent/config docs only if needed for the reviewer/subagent route: `.opencode/agents/reviewer.md`, `templates/common/.opencode/agents/reviewer.md`, `opencode.json`, `templates/common/opencode.json`
- Validation and packaging metadata: `Harness/scripts/validate-harness.mjs`, `templates/common/Harness/scripts/validate-harness.mjs`, `tests/*.test.js`, `scripts/build-version.mjs` only if needed, `templates/common/.harness-version` through `npm run build:version`

Forbidden:
- Production feature code unrelated to Harness workflow/task management
- Release commit/tag/push work
- Secrets, credentials, raw transcripts, full peer CLI logs
- Reverting user or unrelated dirty work such as `.gitignore`, `record.md`, unrelated task capsules, or release task scope

## Memory Preflight

- Memory preflight: done
- Memory hints: none

## Context

- Loaded: `CLAUDE.md`, `Harness/memory/startup-hints.md`, `Harness/MEMORY.md`, `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/workflows/WF.md`, `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/workflows/WF-STATE.md`, `Harness/specs/protocols/TASK_ARCHIVE.md`, `Harness/specs/runtime/subagents.md`, `.agents/skills/wf/SKILL.md`, `.agents/skills/wf-max/SKILL.md`, `.agents/skills/wf-review/SKILL.md`, `.agents/skills/wf-agents-docs/SKILL.md`
- Assumptions: The user's requested "new task" means a Harness task capsule, not source implementation.

## Implementation Package

### Required Changes

1. WF capsule trigger contract:
   - Make `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, and `/skills wf-max` require create-or-reuse of a task capsule before planning, dispatch, implementation, review, or verification.
   - Keep direct mode as default when no explicit WF token exists.
   - Clarify whether `/wf-review` attaches to the active task by default, creates a capsule only when explicitly invoked with no active task, or runs as degraded direct review. Prefer: explicit `/wf-review` is a workflow command and must attach to an active task or create `task-review-<noun>` if no compatible active task exists.

2. Task state and resume model:
   - Extend `STATE.json` template and `WF-STATE.md` with backward-compatible fields for multi-open and dependency-aware work:
     - `links.dependsOn`, `links.blocks`, `links.related`
     - `workItems[]` with `id`, `status`, `phase`, `dependsOn`, `parallelGroup`, `readSet`, `writeSet`, `agent`, `evidence`, `next`
     - Keep existing `queues.ready/running/blocked/done` as compatibility views; allow old string entries and new object entries.
   - Define "open tasks" as non-archived tasks with status `active`, `in_progress`, `running`, `pending`, `blocked`, or `needs-user-decision`.
   - Keep one global active task pointer, but make `/wf-task-list` expose all open tasks and dependency links.
   - Fresh-context `continue` must read the active pointer, active `STATE.json`, `PROGRESS.md`, and only the necessary `PLAN.md`; it must not bulk-load all tasks unless the active pointer is missing or the user explicitly asks for task search/list.

3. Atomic task management commands:
   - `/wf-task-record [task text]`: direct/compat command. It records current user intent into the matching open task when task id or semantic overlap is clear; otherwise creates a new `task-<verb>-<noun>[-detail]` capsule. It does not enter WF unless the user also uses `/wf` or `/wf-max`.
   - `/wf-task-list`: direct/compat command. It lists active/open/blocked/verified/archiveable tasks from `task-state.mjs list --json`, including `nextAction`, blockers, dependencies, and ready/running queue summaries.
   - `/wf-task-archive [--dry-run|--apply] [--task <id>] [--keep <n>]`: direct/compat command. It wraps `task-state.mjs archive`, never archives active/running/blocked/needs-user-decision tasks, and defaults to dry-run.
   - Add Claude Code and OpenCode command wrappers plus Codex-compatible skills. Register docs and validator checks so generated projects include them.

4. `wf-review` peer CLI hardening:
   - Replace "raw peer output first" with "bounded evidence packet first, parsed peer result second, controller synthesis third".
   - Require stdin prompt transport for PowerShell automation.
   - For `claude -p`, use `--output-format json` and fail if stdout is empty, non-JSON, `is_error: true`, `subtype` starts with `error_`, or no final model text/result is present. Do not use tiny `--max-budget-usd` values in real reviews; if a budget is used, record budget exhaustion as BLOCKED rather than reviewer output.
   - For `opencode run --format json`, parse JSONL events and extract final `text` parts; do not treat the whole JSONL stream as the review result.
   - Do not claim `opencode run --agent reviewer` used the reviewer role unless a probe confirms the agent is a primary runnable agent. Current evidence shows `.opencode/agents/reviewer.md` is `mode: subagent` and OpenCode falls back to the default agent.
   - Prefer native reviewer subagent fallback inside the current runtime when OpenCode cannot run reviewer as a primary CLI agent.

5. Mirrors and validation:
   - Keep template source and dogfood runtime mirrors in sync.
   - Update `validate-harness.mjs` and tests so they enforce the new safer strings and stop requiring the unsafe `opencode run --agent reviewer` path as a positive invariant.
   - Run version/checksum generation only after source and template mirrors are settled.

### Dependency Graph

| ID | Work Item | Depends On | Parallel With | Output |
|----|-----------|------------|---------------|--------|
| W1 | Define state/resume schema and docs | none | W2 read-only audit | `WF-STATE.md`, task template, README/CLAUDE routing language |
| W2 | Harden `wf-review` and peer CLI docs | none | W1 | updated `wf-review`, `wf-agents-docs`, subagent/WF-MAX peer CLI references |
| W3 | Implement `task-state.mjs` record/list/open/dependency support | W1 | none | CLI behavior and tests |
| W4 | Add `/wf-task-record`, `/wf-task-list`, `/wf-task-archive` wrappers/skills | W1, W3 | none | Claude/OpenCode commands and Codex skills |
| W5 | Sync templates, mirrors, validators, generator tests | W1, W2, W3, W4 | none | root/template parity and updated checks |
| W6 | Verify and review | W5 | none | passing tests, validator, mirror/version checks, reviewer evidence |

### Subagent Dispatch

| Role | Read / Write Set | Result Needed |
|------|------------------|---------------|
| planner | Read task capsule, WF docs, state script, validator/tests. Write none. | Confirm dependency graph, write sets, and minimal implementation order. |
| implementer-state | Write `WF-STATE.md`, task template, `task-state.mjs`, tests. | Backward-compatible state/list/record/archive behavior. |
| implementer-review | Write `wf-review`, `wf-agents-docs`, peer CLI references, related tests. | Robust peer CLI invocation/output contract. |
| implementer-commands | Write task command wrappers/skills, README/CLAUDE routing, validator registration. | Atomic commands available across Claude Code, Codex, and OpenCode. |
| verifier | Run validation commands and summarize AC matrix. | Evidence for AC-001 through AC-004. |
| reviewer | Read diff and task ACs only. Write none. | Severity-classified findings or PASS. |

Do not run writing implementers in parallel unless their write sets are disjoint. Template/root mirror updates can happen after the first implementation pass to reduce drift.

### Verification Commands

- `node Harness/scripts/task-state.mjs validate --json`
- `node Harness/scripts/task-state.mjs list --json`
- `node Harness/scripts/task-state.mjs archive --dry-run --json`
- New command smoke checks for `record`, open/list/dependency output, and archive dry-run behavior
- `npm test`
- `node Harness/scripts/validate-harness.mjs --strict`
- `node templates/common/Harness/scripts/validate-harness.mjs --strict`
- `npm run build:version`
- `npm run check:mirrors`
- `git diff --check`

## Agents

Only record agents or bounded passes that materially changed the decision.

| Role | Read / Write Set | Result |
|------|------------------|--------|
| Controller intake | Read-only WF docs, skills, CLI help, minimal peer CLI probes / task state only | Confirmed task capsule was needed and gathered initial failure evidence without framework implementation edits. |
| Controller state audit | Read-only `WF-STATE.md`, `WF.md`, `WF-KERNEL.md`, `dispatch.md`, task template, `task-state.mjs` / task state only | Confirmed current state has a single active pointer and per-task queues, but no first-class cross-task dependency graph or multi-open scheduler. |

## Verification

- [x] `node Harness/scripts/task-state.mjs validate --json` reports no errors; warning remains because outer task capsules exceed cap.
- [x] `Get-Command claude,codex,opencode -ErrorAction SilentlyContinue` found all three CLIs.
- [x] `claude --help`, `codex exec --help`, and `opencode run --help` confirmed current CLI flag shapes.
- [x] Minimal `claude -p --output-format json --max-budget-usd 0.05 --strict-mcp-config` probe returned `error_max_budget_usd` before any model result.
- [x] Minimal `opencode run --format json --pure --dir .` probe returned JSONL events, not a single final JSON object.
- [x] Minimal `opencode run --agent reviewer --format json --pure --dir .` probe reported that `reviewer` is a subagent, then fell back to the default agent.
- [x] `rg` state audit found resume routing, `queues`, and `dispatchLedger`, but no explicit cross-task dependency schema in `STATE.json`.
- [ ] Framework implementation not started; paused by user request.

## Risks

- Existing task index is already above the configured outer task cap; archive behavior should be handled separately or through the future task archive command.
- Peer CLI output quality may depend on installed CLI versions and authentication state.

## Expanded Contracts

Use this section only when the Acceptance triggers above apply.

### UI Contract

| Element | Selector / Role | States | AC IDs |
|---------|-----------------|--------|--------|

### API Contract

| Endpoint | Method | Payload / Response | AC IDs |
|----------|--------|--------------------|--------|

### Validation Matrix

| AC ID | Result | Evidence | Notes |
|-------|--------|----------|-------|
