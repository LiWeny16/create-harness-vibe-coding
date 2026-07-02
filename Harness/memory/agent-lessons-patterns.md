# Agent Lessons And Patterns

Purpose: record reusable lessons from review, debugging, validation, and handoff loops.

Write here when:
- A review/debug loop reveals a reusable prevention pattern.
- A validation failure exposes a missing regression check.
- A handoff, dispatch, or context-loading pattern should be repeated or avoided.

Entry format, newest first:

## 2026-07-02 - Only WF-AUTO May Use Runtime Hooks

- Lesson: This scaffold intentionally deletes broad runtime hooks. The only allowed runtime hook is an explicit `/wf-auto` bounded tick hook for long-running auto mode; it must not enforce WF-MAX roles, manage mode state, or inject memory.
- Source: user explicitly confirmed broad hook deletion was intentional and clarified that `/wf-auto` may use a hook for long-chain running.
- Apply when: editing `.claude/settings.json`, `.codex/hooks.json`, `CLAUDE.md`, Harness routers, WF-MAX, WF-AUTO, memory routing, validators, or template mirrors.
- Regression guard: no `wf-mode-hook.mjs`, no `HOOK_PROTOCOL.md`, no hook registration by default, `WF-AUTO.md` owns the only hook exception, and `node Harness/scripts/validate-harness.mjs`.

## 2026-07-02 - Acceptance Criteria Are Workflow Truth

- Lesson: For behavior-changing Harness work, PRD-derived AC IDs must be the source of truth before tests, implementation, review, validation, debug, or memory.
- Source: acceptance-driven workflow upgrade.
- Apply when: planning `/wf`, `/wf-max`, `/wf-auto`, browser/API validation, or subagent dispatch.
- Regression guard: `Harness/ACCEPTANCE_PROTOCOL.md`, `Harness/AGENT_ISOLATION.md`, `Harness/HARNESS_BRIDGE.md`, and validator required-file checks.

```markdown
## YYYY-MM-DD - Short Lesson Name

- Lesson: the reusable pattern.
- Source: review finding, debug loop, failed verification, or handoff.
- Apply when: the task shape or files where this matters.
- Regression guard: test, validator check, docs update, or manual evidence to keep it from recurring.
```

Keep entries lightweight and actionable. Avoid secrets and speculative lessons.
