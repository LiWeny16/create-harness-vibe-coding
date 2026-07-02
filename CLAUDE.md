# CLAUDE.md

This repository dogfoods the generated Harness scaffold. Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

## 1. Harness Binding & Startup

- If `Harness/` exists, this repository is governed by the Harness contract. Treat these files as mandatory operating instructions, not optional references.
- Every session: load `Harness/MEMORY.md` first, then `Harness/README.md`.
- If `Harness/SETUP.md` exists, follow it before normal project work; it is the install/bootstrap contract and may be deleted after setup is complete.

### 1a. WF-MAX Role Contract (ACTIVE ONLY when /wf-max invoked)

`/wf-max` active → top-level orchestrator is **CEO**. Delegated Workers follow dispatch packet, edit only assigned writeSet. **Global mode ≠ every agent is CEO.** (Enforced by hooks + `.runtime/current-mode.json`.)

| ALLOWED (W0 CEO) | FORBIDDEN (always on source) |
|---|---|
| Read Harness docs, CLAUDE.md | Edit / Write / MultiEdit |
| Grep/Glob for scoping | Bash (except `ls`/`dir`/`tree`/`git`) |
| Agent spawn (ONE message) | Deep source reads → delegate to Worker |
| Write PLAN.md / PROGRESS.md | Sequential spawn (AP6) |

**Tempted to edit source? STOP. Spawn a Worker with explicit writeSet.**

- `Harness/MEMORY.md` is the memory/resource router: agents, skills, durable memories, and cross-session lessons. Follow its registrations when selecting agents/skills or recording memory.
- `Harness/README.md` is the task router. For every request, check `Harness/README.md#Load By Task` and `Harness/README.md#Skill Commands`; invoke via `/wf-*` skills or `$wf-*` skills.
- `Harness/PROGRESS.md` is the global task index. Load at session start to see active task and task history.
- If work spans more than one step, create a task capsule from `Harness/tasks/_template/` and update `Harness/tasks/<task-id>/PROGRESS.md`.
- Subagents are readers and reporters. Only the main agent writes to `Harness/tasks/<task-id>/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`.
- Invoke multi-agent work via `subagent-orchestrator` and `Harness/subagents.md`. Update harness via `/wf-update` (see `.claude/skills/wf-update/SKILL.md`).
- For memory writing, dispatch `memory-master`. For context analysis, dispatch `context-master`.
- Never bulk-read `Harness/`; route through `Harness/README.md` and `Harness/MEMORY.md`.
- Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

## 2. Think Before Coding

- You must have **>=95% confidence** in user intent before writing implementation code.
- If confidence is below 95%, stop and ask up to 3 blocking questions.
- If multiple valid approaches exist and the choice affects architecture, scope, stack, or user-facing behavior, present trade-offs instead of picking silently.
- State assumptions before implementation and record durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/tasks/<task-id>/PLAN.md`.
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

- `Harness/MEMORY.md` is the resource index. Detailed durable memory lives in `Harness/memory/`.
- **Tool reflection trigger**: record a lightweight reflection when the same tool/use pattern fails 3+ times, or when a better command pattern/environment fix is found. Write it newest-first in `Harness/memory/tool-usage-reflections.md`.
- **User correction trigger**: record a lightweight preference/correction when the user asks to remember it, or when the user corrects the same assumption/pattern 2+ times. Write it newest-first in `Harness/memory/user-corrections-preferences.md`.
- **Agent lesson trigger**: record reusable lessons from review/debug loops in `Harness/memory/agent-lessons-patterns.md` when they would prevent recurrence.
- **WF auto-trigger**: before WF closeout, dispatch `context-master` then `memory-master` (or use `/wf-learn`). The old "3x same failure" auto-trigger is unreliable — make this a mandatory closeout gate.
- **Context threshold trigger**: when context approaches ~85% of the window, dispatch `context-master` to analyze and write a non-blocking compression suggestion to `Harness/tasks/<task-id>/PROGRESS.md#Heartbeat`.
- **Closeout trigger**: during WF closeout, dispatch `context-master` to extract durable knowledge, then `memory-master` to consolidate into `Harness/memory/*`.
- Never record secrets, credentials, tokens, or private data in memory.

## 7. Mode Constraints

- Never call `EnterPlanMode` — delegate planning to `planner` subagents (see `Harness/WF.md`).
- Never write code directly in `/wf` or `/wf-max` CEO mode — delegate all implementation to Workers via dispatch packets with explicit writeSet.
- **WF-MAX three-layer architecture**: global mode (`wf-max`) ≠ agent role (`ceo|manager|worker|reviewer`). Workers follow dispatch packet (writeSet, forbidden, verification). Missing role/writeSet → source edits denied by default.
- **Enforcement**: `.claude/settings.json` denies `EnterPlanMode` via the `deny` list. Role contract is in [Section 1a](#1a-wf-max-role-contract-read-before-any-tool-use) — read it first.
- WF-MAX hooks in `.claude/settings.json` enforce per-agentRole + writeSet. `Harness/.runtime/current-mode.json` persists mode state; stale modes (>30 min) auto-clear.
