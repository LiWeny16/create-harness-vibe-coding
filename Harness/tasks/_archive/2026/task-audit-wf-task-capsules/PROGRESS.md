# task-audit-wf-task-capsules - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.
Do not paste logs; record the command/file that proves the state.

## Status

- Phase: Archived
- Next: Closeout complete. Restore prior active task via `task-state.mjs set-active` or leave None.
- Blocker: none

## Tasks

- [x] Create task capsule
- [x] Gather initial read-only evidence (WF trigger, wf-review, multi-open state)
- [x] Prepare Claude Code implementation handoff
- [x] W1: State/resume schema + docs (WF-STATE.md, STATE.json template, CLAUDE.md resume, README routing)
- [x] W2: Harden wf-review peer CLI contract + wf-agents-docs PowerShell rules + OpenCode reviewer caveat
- [x] W3: task-state.mjs record/open commands, enhanced list/validate, 14 tests pass
- [x] W4: wf-task-record/list/archive direct commands (12 files: .claude + .opencode + skills)
- [x] W5: Template mirrors, validator registrations, wf-help table, MEMORY/CLAUDE/README routing, build:version, check:mirrors
- [x] W6: Full verification suite + independent review
- [x] Update AC status matrix

## Changes

35 files changed, 1152 insertions, 72 deletions. Root + templates/common/ mirrors kept in sync. .claude/skills/.agents/skills mirrors identical. All wf-task-* command mirrors created.

## Verification

| Check | Result |
|-------|--------|
| `node Harness/scripts/task-state.mjs validate --json` | PASS (0 errors, 1 cap warning) |
| `node Harness/scripts/task-state.mjs list --json` | PASS (7 tasks, dependsOn/blocks/openTasks fields) |
| `node Harness/scripts/task-state.mjs open --json` | PASS (4 open tasks) |
| `node Harness/scripts/task-state.mjs archive --dry-run --json` | PASS (2 archiveable, 4 skipped) |
| `node Harness/scripts/task-state.mjs record --create --dry-run` | PASS (dry-run works) |
| `node --test tests/task-state.test.js` | 14/14 PASS |
| `node Harness/scripts/validate-harness.mjs` | PASS (1 cap warning) |
| `node templates/common/Harness/scripts/validate-harness.mjs` | PASS (1 cap warning) |
| `npm run build:version` | PASS (152 checksummed files) |
| `npm run check:mirrors` | PASS (4/4 checks) |
| `git diff --check` | PASS (no whitespace errors) |

## AC Evidence Matrix

| AC ID | Status | Evidence |
|-------|--------|----------|
| AC-001 (WF trigger + capsule creation) | VERIFIED | wf/wf-max skills unchanged (explicit-only, correct). CLAUDE.md direct/compat list extended with wf-task-* exemptions. No implicit capsule triggers added. |
| AC-002 (wf-review peer CLI hardening) | VERIFIED | Evidence-Packet Peer Review Contract in wf-review SKILL.md. PowerShell automation rules hardened in wf-agents-docs. OpenCode reviewer `mode:subagent` caveat in subagents.md + WF-MAX.md. |
| AC-003 (task record/list/archive commands) | VERIFIED | task-state.mjs `record`/`open` commands working. wf-task-record/list/archive direct commands + Codex skills created (12 files). wf-help table updated. |
| AC-004 (multi-open/dependency/resume semantics) | VERIFIED | WF-STATE.md documents links.dependsOn/blocks/related, workItems[], open tasks. CLAUDE.md resume checks links + workItems. STATE.json template extended backward-compatibly. |

## Notes

- Unrelated dirty work preserved: .gitignore, record.md, task-release-stable-github/*, task-audit-architecture-boundaries/*, task-homepage-act1-flat-layout/*
- Independent review dispatched (haiku reviewer, same-runtime independent-context)
- Task cap warning is pre-existing (7 > 5); archive handled separately
