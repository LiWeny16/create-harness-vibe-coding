# task-wf-ui-control-260729 - PLAN

## Goal

Design and implement a Harness web control panel for task capsules, peer agent terminals, workflow visualization, settings, and observability. Requested entry: $wf-ui.

## Scope

First stage: design the Harness UI control plane and implementation slice.

Included:
- Local browser-hosted panel for Harness task capsules, workflow graph, peer agent sessions, settings, and observability.
- React + TypeScript + Vite/Rolldown app shell evaluation.
- React Flow workflow visualization for tasks, peer agents, dependencies, and reported subagent events.
- xterm-style visible terminal strategy for Claude/Codex/OpenCode PTY sessions.
- File-system task capsule protocol remains the source of truth.

Excluded for first stage:
- npm publish or release work.
- Replacing task capsules with UI-only state.
- Assuming `$wf-ui` already exists as an installed command/skill before this task creates it.

## Decisions

- `$wf-ui` is a new requested Harness control-plane entry, not an existing registered skill/command in the current install.
- UI is an observability and control layer; `Harness/tasks/**` state files remain authoritative.
- Built-in terminal should be browser-hosted, not Windows Console, PowerShell, Windows Terminal, or SendKeys automation.
- Peer agent internal subagents may not be natively attachable; require capsule-level `events.jsonl` reporting for observability.
- Keep large visual/control-plane work separate from the completed `0.8.18` release.

## Acceptance

- AC-001: Produce an architecture plan for `$wf-ui` covering backend server, frontend app, task capsule API, PTY terminal bridge, settings, and security boundaries.
- AC-002: Define the first implementable MVP slice with file locations, dependency strategy, validation commands, and rollback boundaries.
- AC-003: Decide whether `$wf-ui` is a command, skill, script, or combined command+skill surface, and list all mirrors/templates/tests that must be updated.
- AC-004: Keep task capsule file state as the durable source of truth; UI state must be derived or explicitly synchronized.
- AC-005: Record observability limits for cross-runtime peer agents and their nested subagents.
