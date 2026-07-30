# Claude Code Handoff Prompt

Paste this into Claude Code from the repository root.

```text
/wf Continue active Harness task `task-audit-wf-task-capsules`.

Read first, in this order:
1. `CLAUDE.md`
2. `Harness/PROGRESS.md`
3. `Harness/tasks/task-audit-wf-task-capsules/STATE.json`
4. `Harness/tasks/task-audit-wf-task-capsules/PROGRESS.md`
5. `Harness/tasks/task-audit-wf-task-capsules/PLAN.md`

Do not start from scratch and do not create a duplicate task. Use the existing task capsule and keep it current.

Objective:
Implement the task package in `Harness/tasks/task-audit-wf-task-capsules/PLAN.md#Implementation Package`.

Required outcomes:
- Explicit `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, and `/skills wf-max` invocations must create or reuse a task capsule before planning, dispatch, implementation, review, or verification.
- Non-explicit/direct user requests must not enter capsule mode automatically.
- Add task-management direct/compat commands and Codex skills for `wf-task-record`, `wf-task-list`, and `wf-task-archive`.
- Extend task state/resume semantics so a fresh agent that receives "continue" can deterministically resume from `Harness/PROGRESS.md` and the active task `STATE.json`; add first-class fields or a backward-compatible model for open tasks, cross-task dependencies, parallel groups, and ready/running/blocked/done work items.
- Harden `wf-review` and `wf-agents-docs` so peer CLI calls through `claude -p`, `codex exec`, or `opencode run` return bounded, parsed evidence packets. Do not treat raw stdout/transcripts as review results.
- Do not claim `opencode run --agent reviewer` is using the reviewer role unless a live probe proves the agent is primary-runnable. Current evidence says `.opencode/agents/reviewer.md` is `mode: subagent` and OpenCode falls back to the default agent.

Constraints:
- Do not commit, push, tag, npm publish, or touch unrelated user changes.
- Preserve dirty work you did not create, including `.gitignore`, `record.md`, unrelated task capsules, and release task files unless directly required.
- Keep dogfood runtime files and `templates/common/` sources in sync.
- Keep `.claude/skills/*` and `.agents/skills/*` mirrors in sync. If generator scripts are the intended mirror path, run them and verify the result.
- Update validator and tests so old unsafe invariants are removed and new behavior is enforced.
- Use stdin for PowerShell peer CLI automation. Parse JSON/JSONL and fail on empty output, non-JSON output, explicit error events, budget errors, fallback warnings, or missing final model text.

Suggested implementation order:
1. Run `git status --short` and `node Harness/scripts/task-state.mjs validate --json`.
2. Implement W1 from the task `STATE.json`: state/resume schema and docs.
3. Implement W2: `wf-review` and peer CLI docs hardening.
4. Implement W3: task-state CLI support for record/list/open/dependency behavior, with tests.
5. Implement W4: `wf-task-record`, `wf-task-list`, `wf-task-archive` command wrappers and Codex skills.
6. Implement W5: template/root mirrors, validator checks, generator/pack tests, version metadata if needed.
7. Run verification:
   - `node Harness/scripts/task-state.mjs validate --json`
   - `node Harness/scripts/task-state.mjs list --json`
   - `node Harness/scripts/task-state.mjs archive --dry-run --json`
   - new task command smoke tests
   - `npm test`
   - `node Harness/scripts/validate-harness.mjs --strict`
   - `node templates/common/Harness/scripts/validate-harness.mjs --strict`
   - `npm run build:version`
   - `npm run check:mirrors`
   - `git diff --check`
8. Run one independent review pass. If using peer CLI, follow the hardened contract from this task; otherwise use a same-runtime reviewer subagent and label it as same-runtime independent-context review, not cross-model review.
9. Update `Harness/tasks/task-audit-wf-task-capsules/PLAN.md`, `PROGRESS.md`, and `STATE.json` with evidence and final status.

Acceptance criteria are AC-001 through AC-004 in the task PLAN and STATE. Do not close until each has evidence.
```
