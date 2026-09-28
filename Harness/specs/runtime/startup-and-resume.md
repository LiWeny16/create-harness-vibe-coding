# Harness Startup, Binding & Resume — Detail

Load this file only when one of these applies:

- Running inside a Harness-managed PTY node (`HARNESS_NODE_INIT` or `HARNESS_PEER_SESSION_ID` set)
- The user entered `/wf`, `/wf-max`, `/wf-auto*`, or an equivalent trigger
- The user said "continue", "resume", "last task", "current task", "status", "where were we"

Otherwise `CLAUDE.md` alone is sufficient.

## 1. Node Identity & Workflow Context Hydration

When running inside a Harness-managed PTY node, the backend injects identity
through environment variables instead of terminal prompt text. If
`HARNESS_NODE_INIT` or `HARNESS_PEER_SESSION_ID` is set, quietly read the file
pointed to by `HARNESS_NODE_INIT` before taking node-specific action. Use
`HARNESS_PEER_SESSION_ID`, `HARNESS_WORKFLOW_NODE_ID`, `HARNESS_AGENT_KIND`,
`HARNESS_PEER_RUNTIME`, `HARNESS_WORKFLOW_MAP`, `HARNESS_NODE_HOME`, and
`HARNESS_WF_UI_URL` to identify this node, runtime, graph position, and control
plane. Do not require or wait for a user-injected bootstrap prompt.

Workflow context hydration is mandatory and unconditional in a managed node. At
the start of every operator turn, silently read this node's workflow context
with `node Harness/scripts/wf-ui-control.mjs workflow-context --project .`;
`HARNESS_WORKFLOW_NODE_ID` selects the current graph node. Do not skip hydration
based on wording: local shell, Git, MCP, coding, review, debugging, and runtime
questions still hydrate first so current graph identity, connected nodes, and
connected affordances are known. Before controlling, mutating, delegating to,
reading from, or writing to any node, hydrate context again if the last context
read happened before a graph change or operator message. If hydration fails, say
workflow context is unavailable before making claims about node-map connections
or control targets. Do not print the command or raw JSON unless asked.

Workflow node state files under `Harness/a2a/**/state.json` and
`Harness/a2a/workflow-map.json` are backend-owned diagnostic storage, not
control surfaces, nor information sources — read graph and connection state
only through the typed wf-ui API/CLI. Do not edit event-node, goal-node,
component-node, capability-node, node-home, workflow-map, or task state files
to control Timer, Goal, Agent, resource, capability, or graph state; use the
typed wf-ui backend API commands instead.

## 2. Agent Team Cooperation (WF / WF-MAX)

When the user enters `/wf`, `$wf`, `/wf-max`, or `$wf-max`, the main Agent node autonomously: understands the task and decides whether team collaboration is needed; finds existing agents by role or capability; connects or creates sub-agents with a role profile (displayName + roleTitle); shares context through Markdown nodes (referenced by nodeId only); sends structured requests with a request id; waits via Timer wakeup messages, checked on the agent's next turn; aggregates replies; ticks Goal items and completes the Goal when all items are checked. When the target is ambiguous, ASK THE USER — never blindly create or connect an agent.

**Subagent Strategy:** Subagent mode comes from node settings (built-in-subagents default = native helpers, no canvas nodes; wf-node-subagents = visible canvas agents). Natural language: "内部助手"/"内置子代理" → built-in; "画布节点"/"WF node协作" → wf-node. Discover everything at runtime: help --json, workflow-context, manuals <type>, snapshot, workflow-ontology.

Never edit `Harness/a2a/**/state.json` directly; use typed actions only. The Timer is the only wakeup source; the Goal node never wakes agents. Explain all of this to the user in plain language, without broadcast/A2A/thread/shared-context terminology.

## 3. WF-MAX Role Contract

This section is active only when `/wf-max` is invoked.

In `/wf-max`, the top-level agent is the **CEO**. The CEO owns task framing, decomposition, dispatch, review coordination, and task evidence.

The CEO must not edit source files directly. Source edits must be delegated to Workers through dispatch packets with explicit boundaries.

Each Worker dispatch must define: role, objective, allowed writeSet, forbidden files/actions, required verification, and expected return evidence.

Workers may edit only inside their assigned writeSet. Reviewers and verifiers must be independent from the Worker whose output they evaluate.

Detailed WF-MAX role rules live in `Harness/specs/workflows/WF-KERNEL.md`, `Harness/specs/workflows/WF-MAX.md`, and `Harness/specs/runtime/subagents.md`.

## 4. Active Task Resume

Durable WF task ownership is opt-in and sticky. Only a task explicitly created
or entered with `wf` or `wf-max` is WF-managed. When that task remains `active`
or `blocked`, the next session automatically resumes WF mode from it; the user
does not need to repeat the trigger. A `direct`, `wf-auto`, `wf-auto-spark`,
`wf-review`, or `wf-browser` task never becomes a durable WF task by inference.
A managed task cannot exit or downgrade its mode: close it terminally, then
create a new task with an explicit WF trigger.

If the user says "continue", "resume", "last task", "current task", "status",
"where were we", or similar resume language, or the current work is not a simple
direct task:

1. Read `Harness/PROGRESS.md` → find Active Task.
2. If Active Task exists, read `Harness/tasks/<active-task>/STATE.json` first.
3. From STATE.json, check `links.dependsOn` — if non-empty, check whether any dependency tasks are still open (STATE.json status is `active` or `blocked`; legacy statuses are normalized) and report blocked dependencies.
4. From STATE.json, check `workItems[]` — if non-empty, inspect items with status `running` or `ready` for parallel dispatch candidates.
5. Read `Harness/tasks/<active-task>/PROGRESS.md`.
6. Read `Harness/tasks/<active-task>/PLAN.md` only if decisions or scope need review.
7. From STATE.json, recover: phase, gate, tier, ready/running/blocked/done queues, activeQuestion, nextAction.
8. Do NOT bulk-read `Harness/tasks/` to find context. Use the active pointer and `Harness/tasks/INDEX.json` for deterministic project/group lookup. The pointer is a focus/resume hint, not a single-task lock; multiple open tasks are valid.

If the active pointer names an open `wf`/`wf-max` task, the sticky lifecycle
rule above takes precedence over the generic direct-task shortcut. Multiple
open tasks are allowed, but the Harness focus remains a WF task until it is
closed or another WF task is explicitly selected.

9. Direct simple tasks may skip STATE/PLAN/PROGRESS unless the user says "continue"/"resume". The `continue` keyword resolves deterministically from the active pointer plus STATE.json — it always recovers the same state.

See `Harness/specs/workflows/WF-STATE.md` for the full state machine contract. Completed/abandoned tasks are archived to `Harness/tasks/_archive/` per `Harness/specs/protocols/TASK_ARCHIVE.md`.
