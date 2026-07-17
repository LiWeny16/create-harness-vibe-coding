# CLAUDE.md

This repository dogfoods the generated Harness scaffold. Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

## 1. Harness Binding & Startup

If `Harness/` exists, this repository is governed by the Harness contract.

Use **direct mode** for simple, single-step, low-risk requests: commit, push, one-line fix, file read, code question, git log, git status, or similar small operations.

In direct mode, do not load the full Harness router. Inspect only the files needed for the task and execute directly.

Complex work may use direct planning, task capsules, tests, and subagents without entering WF. WF mode is explicit only: the user must type `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, `/skills wf-max`, or explicitly say `wf` / `wf-max` to enter WF.

`/wf-help` and `/wf-update` are **direct commands** — do NOT load `Harness/MEMORY.md`, do NOT enter WF, do NOT invoke a skill. Execute them immediately as static help / script commands respectively.

For actual workflow commands (`/wf`, `/wf-max`, `/wf-auto`, `/wf-review`, `/wf-learn`, `/wf-readme`, `/wf-remove`, `/wf-browser`, `/wf-auto-spark`), load `Harness/MEMORY.md` first, then `Harness/README.md`.

### Active Task Resume

If the user says "continue", "resume", "last task", "current task", "status", "where were we", or similar resume language, or the current work is not a simple direct task:

1. Read `Harness/PROGRESS.md` → find Active Task.
2. If Active Task exists, read `Harness/tasks/<active-task>/STATE.json` first.
3. Read `Harness/tasks/<active-task>/PROGRESS.md`.
4. Read `Harness/tasks/<active-task>/PLAN.md` only if decisions or scope need review.
5. From STATE.json, recover: phase, gate, tier, ready/running/blocked/done queues, activeQuestion, nextAction.
6. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer.
7. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says "continue"/"resume".

See `Harness/WF-STATE.md` for the full state machine contract. Completed/abandoned tasks are archived to `Harness/tasks/_archive/` per `Harness/TASK_ARCHIVE.md`.

Use **/wf** for multi-step work that needs structured coordination. Use **/wf-max** for maximum-parallelism with CEO/Manager/Worker decomposition. See `Harness/WF.md` for tier selection (WF-Light, WF-Standard, WF-Full) and `Harness/WF-MAX.md` for fan-out rules (WF-Max-Useful, WF-Max-Strict).

`Harness/SETUP.md` is a bootstrap-only document: it exists only while the harness install is not yet finalized. If it exists, finish the bootstrap it describes once, then delete or archive it. Installed projects must not keep `Harness/SETUP.md` in the startup path, and normal sessions must not route through it.

### 1a. WF-MAX Role Contract

This section is active only when `/wf-max` is invoked.

In `/wf-max`, the top-level agent is the **CEO**. The CEO owns task framing, decomposition, dispatch, review coordination, and task evidence.

The CEO must not edit source files directly. Source edits must be delegated to Workers through dispatch packets with explicit boundaries.

Each Worker dispatch must define: role, objective, allowed writeSet, forbidden files/actions, required verification, and expected return evidence.

Workers may edit only inside their assigned writeSet. Reviewers and verifiers must be independent from the Worker whose output they evaluate.

Detailed WF-MAX role rules live in `Harness/WF-KERNEL.md`, `Harness/WF-MAX.md`, and `Harness/subagents.md`.

## 2. Think Before Coding

- You must have **>=95% confidence** in user intent before writing implementation code.
- If confidence is below 95%, stop and ask up to 3 blocking questions.
- If multiple valid approaches exist and the choice affects architecture, scope, stack, or user-facing behavior, present trade-offs instead of picking silently.
- State assumptions before implementation and record only durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
- If something is unclear, stop. Name what is unclear and ask instead of guessing.
- Before asserting a fact about the codebase, read the file that proves it. If you cannot cite the file and line, do not assert.

## 3. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No unrequested flexibility, configurability, or speculative error handling.
- Use explicit interfaces or state models only when they protect a real boundary, clarify ownership, or make verification/recovery simpler.
- If a simpler approach exists, say so and prefer the smallest change that satisfies the request.
- If the solution is growing faster than the problem, reduce scope before coding more.

## 4. Surgical Changes

- Touch only files and lines required by the task.
- Do not improve adjacent code, comments, formatting, or architecture unless it is required for the task.
- Match existing style even when you would choose a different style in a new project.
- Clean up imports, variables, functions, and files made unused by your own changes; do not delete pre-existing dead code unless asked.
- Keep every changed line traceable to the user's request.

## 5. Goal-Driven Execution

- Define verifiable success criteria before implementation.
- For bugs, reproduce the failure or document why reproduction is impossible before fixing.
- For multi-step work, keep `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` current. Only the controller or task-scribe writes task state; subagents return suggestions only.
- State assumptions before implementation and record only durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
- Every task needs a test, build check, validator run, or recorded manual check.
- Do not claim web/UI acceptance without real-browser evidence from Chrome DevTools, CDP, Playwright, or documented manual browser checks.
- Do not place project build scripts, git conventions, run commands, or release process in this file. Put them in `README.md`.
- Do not place code architecture here. Put architecture in `Harness/architecture.md` or the current feature doc.
- If this file has accumulated unrelated project notes, pause and propose moving them to the right place: `README.md` for development operations, `Harness/architecture.md` for architecture, `Harness/WF.md` or `Harness/workflows/` for workflow rules.

## 6. Memory & Self-Learning

`Harness/MEMORY.md` is the memory and resource router. Detailed durable memory lives under `Harness/memory/`.

Do not write memory directly unless the selected workflow allows it. For workflow closeout, use the registered context and memory workflow to extract durable lessons, decisions, corrections, and reusable patterns.

Keep memory compact, durable, and reusable. Do not record transient logs, raw command output, speculative notes, or information that belongs in task-local PLAN.md / PROGRESS.md.

Never record secrets, credentials, tokens, or private data in memory.

## 7. Mode Constraints

- Never call `EnterPlanMode`. Delegate planning to `planner` subagents (see `Harness/WF.md`).
- In `/wf` or `/wf-max`, follow the selected workflow role contract instead of improvising execution flow.
- In `/wf-max`, the CEO must not edit source files directly. Implementation must be delegated to Workers with explicit writeSet boundaries.
- If a Worker dispatch is missing role, objective, writeSet, forbidden scope, or verification requirements, the controller must not proceed with source edits.

Keep CLAUDE.md as a thin routing and global-behavior file. Put detailed workflows in `Harness/WF.md` or `Harness/workflows/`, subagent rules in `Harness/subagents.md`, architecture in `Harness/architecture.md`, and project operations in `README.md`.
