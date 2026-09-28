# CLAUDE.md

This repository dogfoods the generated Harness scaffold. Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

Keep this file thin. Detailed workflows live in `Harness/specs/workflows/`, subagent rules in `Harness/specs/runtime/subagents.md`, architecture in `Harness/project/architecture.md`, project operations in `README.md`.

## 0. Routing

Default startup is thin: load `CLAUDE.md`, then `Harness/memory/startup-hints.md` (L2 digest, 5-10 hints). This is NOT loading `Harness/MEMORY.md`, `Harness/README.md`, or `Harness/PROGRESS.md`.

Read `Harness/specs/runtime/startup-and-resume.md` **only** when one of these applies:

- Running inside a Harness-managed PTY node (`HARNESS_NODE_INIT` or `HARNESS_PEER_SESSION_ID` set)
- The user entered `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, `/wf-auto`, `$wf-auto`, `/wf-auto-spark`, or `$wf-auto-spark`
- The user said "continue", "resume", "last task", "current task", "status", "where were we"

Resume mechanics (`continue` keyword, STATE.json recovery) are governed by `Harness/specs/workflows/WF-STATE.md`; completed/abandoned tasks archive per `Harness/specs/protocols/TASK_ARCHIVE.md`.

If `Harness/` exists, this repository is governed by the Harness contract.

Use **direct mode** for simple, single-step, low-risk requests: commit, push, one-line fix, file read, code question, git log, git status, or similar small operations. In direct mode, do not load the full Harness router. Inspect only the files needed and execute directly.

Complex work may use direct planning, task capsules, tests, and subagents without entering WF. WF execution modes are explicit only — no other phrasing, complexity heuristic, or inferred intent triggers WF.

`/wf-help`, `$wf-help`, `/skills wf-help`, `/wf-update`, `$wf-update`, `/skills wf-update`, `/wf-task-record`, `$wf-task-record`, `/skills wf-task-record`, `/wf-task-list`, `$wf-task-list`, `/skills wf-task-list`, `/wf-task-archive`, `$wf-task-archive`, `/skills wf-task-archive`, `/wf-command-create`, `$wf-command-create`, `/skills wf-command-create`, `/wf-ui`, `$wf-ui`, `/skills wf-ui`, `/wf-init`, `$wf-init`, `/skills wf-init`, `/wf-search`, `$wf-search`, `/skills wf-search`, `/wf-extension`, `$wf-extension`, and `/skills wf-extension` are **direct/compat commands** — do NOT load `Harness/MEMORY.md`, do NOT enter WF. Hosts execute direct command files; Codex may invoke compatibility skill shims.

**Non-direct workflow commands** (`/wf`, `/wf-max`, `/wf-auto`, `/wf-review`, `/wf-learn`, `/wf-readme`, `/wf-remove`, `/wf-browser`, `/wf-auto-spark`, and matching `$wf-*` / `/skills wf-*` forms): load `Harness/MEMORY.md` first, then `Harness/README.md`.

Use **/wf** for multi-step work needing structured coordination. Use **/wf-max** for maximum-parallelism with CEO/Manager/Worker decomposition. See `Harness/specs/workflows/WF.md` for tier selection (WF-Light, WF-Standard, WF-Full) and `Harness/specs/workflows/WF-MAX.md` for fan-out rules.

WF entry uses a bounded role pack (`task-context.mjs pack`) and fresh `show`/`pack` on resume. Before external web/GitHub/Hugging Face lookup, ask `research-policy.mjs decide`; search only when `search: true` and record source metadata plus adopt/adapt/reject. Direct commands stay direct.

## 1. User-Facing Language

Match the user's language for all user-facing prose. Use the dominant language of the latest user message unless the user explicitly asks for another language; preserve code, identifiers, file paths, commands, logs, and quoted source text exactly.

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
- Every task needs a test, build check, validator run, or recorded manual check.
- Do not claim web/UI acceptance without real-browser evidence from Chrome DevTools, CDP, Playwright, or documented manual browser checks.
- Do not place project build scripts, git conventions, run commands, release process, or architecture in this file. Put operations in `README.md`, architecture in `Harness/project/architecture.md`.

## 5a. Low-Noise Progress

- Keep intermediate user updates to 1-2 short sentences.
- Do not recap the plan, paste logs, or narrate obvious file reads between steps.
- Save full detail for the final response: changed files, verification results, risks, and commit hash when relevant.
- For long-running work, report only meaningful phase changes, blockers, failed commands, or user decisions needed.

## 6. Memory & Self-Learning

`Harness/MEMORY.md` is the memory and resource router. Detailed durable memory lives under `Harness/memory/`.

Do not write memory directly unless the selected workflow allows it. For workflow closeout, use the registered context and memory workflow to extract durable lessons, decisions, corrections, and reusable patterns.

Keep memory compact, durable, and reusable. Do not record transient logs, raw command output, speculative notes, or information that belongs in task-local PLAN.md / PROGRESS.md.

Never record secrets, credentials, tokens, or private data in memory.

## 7. Mode Constraints

- Never call `EnterPlanMode`. Delegate planning to `planner` subagents (see `Harness/specs/workflows/WF.md`).
- In `/wf` or `/wf-max`, follow the selected workflow role contract instead of improvising execution flow.
- In `/wf-max`, the CEO must not edit source files directly. Implementation must be delegated to Workers with explicit writeSet boundaries. If a Worker dispatch is missing role, objective, writeSet, forbidden scope, or verification requirements, the controller must not proceed with source edits.
