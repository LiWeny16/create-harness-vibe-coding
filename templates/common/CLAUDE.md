# CLAUDE.md

Root entry for Claude Code. Keep this file short.

## 1. Harness Binding & Startup

- If `Harness/` exists, this repository is governed by the Harness contract. Treat these files as mandatory operating instructions, not optional references.
- Every session: load `Harness/MEMORY.md` first, then `Harness/README.md`.
- If `Harness/SETUP.md` exists, follow it before normal project work; it is the install/bootstrap contract and may be deleted only after setup is complete.
- `Harness/MEMORY.md` is the memory/resource router: agents, skills, durable memories, and cross-session lessons. Follow its registrations when selecting agents/skills or recording memory.
- `Harness/README.md` is the task router. For every request, check `Harness/README.md#Load By Task`; if a row matches, read and follow those docs before acting.
- If work spans more than one step, update `Harness/PLAN.md`.
- Use `/wf`, `wf-mode`, or `Harness/WF.md` for long, difficult, uncertain, multi-file, or repeated-failure work.
- Use `subagent-orchestrator` and `Harness/subagents.md` when coordinating multiple subagents.
- Universal rules live in `.claude/rules/ecc/common.md`.
- Never bulk-read `Harness/`; route through `Harness/README.md` and `Harness/MEMORY.md`.

## 2. Think Before Coding

- You must have **>=95% confidence** in user intent before writing implementation code.
- If confidence is below 95%, stop and ask up to 3 blocking questions.
- If multiple valid approaches exist and the choice affects architecture, scope, stack, or user-facing behavior, present trade-offs instead of picking silently.
- State assumptions before implementation and record durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/PLAN.md`.
- If something is unclear, stop. Name what is unclear and ask instead of guessing.

## 3. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No unrequested flexibility, configurability, or speculative error handling.
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
- For multi-step work, keep `Harness/PLAN.md` current with loaded context, task state, assumptions, and verification.
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
- Never record secrets, credentials, tokens, or private data.
