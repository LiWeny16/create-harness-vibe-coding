# CLAUDE.md

This repository dogfoods the generated Harness scaffold. Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

## 1. Harness Binding & Startup

If `Harness/` exists, this repository is governed by the Harness contract.

Use **direct mode** for simple, single-step, low-risk requests: commit, push, one-line fix, file read, code question, git log, git status, or similar small operations.

In direct mode, do not load the full Harness router. Inspect only the files needed for the task and execute directly.

Use **workflow mode** when the user explicitly invokes a `/wf-*` command, or when the task is multi-step, ambiguous, risky, architectural, cross-file, or requires coordination.

In workflow mode, load `Harness/MEMORY.md` first, then `Harness/README.md`.

If `Harness/SETUP.md` exists, follow it before normal project work; it is the install/bootstrap contract and may be deleted after setup is complete.

### 1a. WF-MAX Role Contract

This section is active only when `/wf-max` is invoked.

In `/wf-max`, the top-level agent is the **CEO**. The CEO owns task framing, decomposition, dispatch, review coordination, and task evidence.

The CEO must not edit source files directly. Source edits must be delegated to Workers through dispatch packets with explicit boundaries.

Each Worker dispatch must define: role, objective, allowed writeSet, forbidden files/actions, required verification, and expected return evidence.

Workers may edit only inside their assigned writeSet. Reviewers and verifiers must be independent from the Worker whose output they evaluate.

Detailed WF-MAX role rules live in `Harness/WF-MAX.md` and `Harness/subagents.md`.

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
- For multi-step work, keep `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md` current. The main agent is the only state committer; subagents return suggestions only.
- State assumptions before implementation and record durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
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
