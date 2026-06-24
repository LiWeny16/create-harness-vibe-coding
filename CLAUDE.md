# CLAUDE.md

## 1. Harness Binding & Startup

- This repository dogfoods the generated Harness scaffold while developing the scaffold itself.
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
- Scaffold source files live under `templates/common/` and `templates/optional/`; generated dogfood runtime files live under root `Harness/` and `.claude/`.

---

## 2. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- You must have at least 95% confidence in user intent before writing implementation code.
- If confidence is below 95%, stop and ask. False confidence is worse than a question.
- Ask at most 3 blocking questions per decision point. Ask the highest-impact questions first.
- If two valid approaches exist and you cannot decide with 95% confidence, present both tradeoffs to the user.
- State assumptions before implementation and record durable assumptions, decisions, blockers, handoffs, and verification evidence in `Harness/PLAN.md`.

## 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No unrequested flexibility or configurability.
- No error handling for impossible scenarios.
- If the solution is much larger than the problem, simplify before continuing.

## 4. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Do not improve adjacent code, comments, or formatting unless needed for the task.
- Do not refactor unrelated code.
- Match existing style.
- If you notice unrelated dead code, mention it instead of deleting it.
- Every changed line should be traceable to the user's request.

## 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- Transform tasks into verifiable goals before implementation.
- For multi-step work, keep `Harness/PLAN.md` current with loaded context, task state, assumptions, and verification.
- Do not claim work is complete until tests or explicit manual verification have been run and recorded.

## 6. File Ownership

- Do not place project build scripts, git conventions, run commands, or release process in this file. Put them in `README.md`.
- Do not place code architecture here. Put architecture in `Harness/architecture.md` or the current feature doc.
- If this file has accumulated unrelated project notes, pause and propose moving them to the right place: `README.md` for development operations, `Harness/architecture.md` for architecture, `Harness/WF.md` or `Harness/workflows/` for workflow rules.

## 7. Memory & Self-Learning

- `Harness/MEMORY.md` is the resource index. Detailed durable memory lives in `Harness/memory/`.
- **Tool reflection trigger**: record a lightweight reflection when the same tool/use pattern fails 3+ times, or when a better command pattern/environment fix is found. Write it newest-first in `Harness/memory/tool-usage-reflections.md`.
- **User correction trigger**: record a lightweight preference/correction when the user asks to remember it, or when the user corrects the same assumption/pattern 2+ times. Write it newest-first in `Harness/memory/user-corrections-preferences.md`.
- **Agent lesson trigger**: record reusable lessons from review/debug loops in `Harness/memory/agent-lessons-patterns.md` when they would prevent recurrence.
- Never record secrets, credentials, tokens, or private data in memory.
