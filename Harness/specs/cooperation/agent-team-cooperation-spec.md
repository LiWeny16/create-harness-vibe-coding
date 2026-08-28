# Agent Team Cooperation Layer — Unified Schemas & Contracts

Status: normative for task `task-agent-team-cooperation-layer` (W2a-W2c implementers)
Applies to: `src/wf-ui-server/**`, `Harness/scripts/wf-ui-control.mjs`, `Harness/a2a/skills/*.json`, `src/ui/**`
Owner: spec + contracts (W1); backend/prompt/UI implementers consume this document.

This spec is the single source of truth for the cooperation contracts. Every
backend action name, envelope field, error shape, and manual field below is
normative. When an implementer finds a conflict between this spec and existing
code, the code is out of date and must be changed to match the spec.

## 1. Purpose

When the user enters `/wf`, `$wf`, `/wf-max`, or `$wf-max`, the main Agent node
must be able to autonomously: understand the task, decide whether team
collaboration is needed, find existing agents by role or capability, connect or
create sub-agents (each with a role profile), share context through Markdown
nodes (referenced by nodeId only), send structured requests, wait via Timer
wakeup messages, aggregate replies, tick Goal items, and complete the Goal when
done. This spec defines the schemas and contracts for every step.

Non-goals (user spec section 十): no A2A jargon for users; no remote A2A
protocol server; no infinite background scheduler; no bypassing backend-owned
state; no hard-coded Claude/Codex-only scenarios; Goal node never wakes agents.

## 2. Main-Agent Decision Flow (AC-024, T1-T3)

The WF/WF-MAX prompt must implement this 10-step flow (agent-facing; user-facing
reporting uses plain language, no jargon):

1. Understand the task from the user request.
2. Decide whether team collaboration is needed (complexity/tier heuristics;
   simple requests are handled directly, no team).
3. Choose the required roles from the unified roleTitle vocabulary (§3).
4. Find existing agents by role / runtime / provider / capability / title (§4).
5. Exactly one unambiguous match → auto-connect that agent.
6. No match and the task target is clear → create an agent with a role profile.
7. Multiple matches or an unclear target → ask the user; never blindly
   create or connect (§4 ask-user gate).
8. Share durable context through Markdown nodes, referenced by nodeId only (§8).
9. Send structured requests (§5), wait via Timer wakeup messages (§6),
   aggregate replies per request.
10. Tick Goal items; complete the Goal when all items are checked (§7); report
    to the user in plain language.

## 3. Role Profile Contract (AC-001, AC-002, AC-003, AC-004; M3)

### 3.1 roleTitle unified vocabulary

`roleTitle` is the single role vocabulary. Canonical ids:

```
ceo | manager | implementer | reviewer | verifier | planner | terminal-controller
```

- `ceo` — main/coordinating agent (root Agent node).
- `manager` — sub-team lead that itself coordinates workers.
- `implementer` — writes code/files inside an assigned write set.
- `reviewer` — reviews others' output; independent from the implementer.
- `verifier` — runs verification/tests; independent from the implementer.
- `planner` — task framing, acceptance criteria, plans.
- `terminal-controller` — owns terminal/PTY operations.

`roleTitle` may also carry a free-form role (e.g. `"architect"`, `"data-expert"`);
free-form values are preserved as-is and are still findable by capability.
`Harness/a2a/role-graph.json` remains the role *graph* vocabulary
(agentId, kind, skills, permissions); `roleTitle` is the *session/profile*
vocabulary. Mapping from role-graph kinds: `controller`→`ceo`,
`planner`→`planner`, `architecture`→free-form `architect`,
`implementer`→`implementer`, `review`→`reviewer`, `validation`→`verifier`,
`runtime`→`terminal-controller`.

### 3.2 Resolving the CLI vs session-registry vocabulary conflict (M3)

Two vocabularies exist today: CLI/UI `Main Agent` / `Subagent` (agentKind) and
session-registry `role` defaulting to `'terminal-agent'`. Resolution:

- `agentKind` (`main` | `subagent`) remains a **lifecycle flag only** (PTY
  spawn policy, force-unconnected permission). It is never user-facing role
  identity.
- `displayName` is the user-visible name (e.g. `"Frontend Expert"`).
- `roleTitle` is the role identity; the session-registry `role` field is
  derived from it: main agent → `ceo` (or free-form), sub-agents → their
  profile `roleTitle`.
- `'terminal-agent'` remains only as the legacy default for manually spawned
  PTYs that have no role profile.
- `find` by role normalizes synonyms: `Main Agent`→agentKind `main`,
  `Subagent`→agentKind `subagent`, role-graph kind→canonical roleTitle.

### 3.3 Profile schema

Written at `create-agent` time as both a session record field set and a
markdown profile file. JSON example (session/API shape):

```json
{
  "nodeId": "agent-3f9c",
  "displayName": "Frontend Expert",
  "roleTitle": "implementer",
  "agentKind": "subagent",
  "responsibility": "Implement UI changes inside the assigned write set; run typecheck and build; return evidence.",
  "runtime": "claude",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "capabilities": ["ui-control-plane", "typescript", "playwright", "wf-ui-map"],
  "roleProfileRef": "Harness/a2a/agent-roles/agent-3f9c.md",
  "createdAt": "2026-08-12T09:00:00.000Z",
  "createdBy": "agent-ceo"
}
```

Field rules:

| Field | Required | Rule |
|-------|----------|------|
| `nodeId` | yes | graph node id of the agent |
| `displayName` | yes | user-visible name; distinct per agent |
| `roleTitle` | yes | canonical id or free-form; two agents in the same team must not share a canonical roleTitle (AC-004) |
| `agentKind` | yes | `main` or `subagent`; lifecycle flag only |
| `responsibility` | yes | one-paragraph mandate, plain language |
| `runtime` / `provider` / `model` | yes / optional / optional | from session-registry `ALLOWED_RUNTIMES` (D3: cross-runtime metadata; only current runtime spawns real sessions) |
| `capabilities` | yes | string array; find query filter |
| `roleProfileRef` | yes | path `Harness/a2a/agent-roles/<nodeId>.md` |

### 3.4 Storage and lifecycle

- Location: `Harness/a2a/agent-roles/<nodeId>.md` (markdown: YAML-ish header
  fields + responsibility prose). Backend-owned; agents never write it.
- Written at `create-agent` (AC-001), alongside the session record, BEFORE the
  node home init prompt is assembled (F15/D12): the create path creates/reads
  the profile first, then the init prompt carries the identity block —
  `Display name`, `Role title`, `Responsibility`, `Capabilities`, and
  `Role profile: <roleProfileRef>` — so the agent sees its identity before any
  task text. Legacy sessions without a profile keep the previous init shape.
- Injected into the agent's context / init prompt on every context build
  (AC-002): the agent sees its own `displayName`, `roleTitle`,
  `responsibility`, and `roleProfileRef` contents before any task text.
- Deleted/archived when the agent node is deleted; not editable by agents.

## 4. Find / Connect / Create Routing Contract (AC-005..AC-008; T4, T6, T7, T13)

### 4.1 Find

`GET /api/workflow/agents/find?role=&runtime=&provider=&capability=&title=`
(CLI: `wf-ui-control.mjs find-agent --role ... --capability ... --project .`).
All filters optional; capability and title support substring match; role
matches by canonical roleTitle, free-form roleTitle, or agentKind synonym.

Response shape:

```json
{
  "query": { "role": "implementer", "capability": "ui-control-plane" },
  "matches": [
    {
      "nodeId": "agent-3f9c",
      "displayName": "Frontend Expert",
      "roleTitle": "implementer",
      "agentKind": "subagent",
      "runtime": "claude",
      "provider": "anthropic",
      "capabilities": ["ui-control-plane", "typescript"],
      "connected": false,
      "status": "stopped"
    }
  ],
  "count": 1
}
```

### 4.2 Auto-connect rule (T6)

Exactly one match for the requested role/capability → connect it
(`agent.connectNodes` edge created, bidirectional) and return `{decision:
'connect', nodeId}`. Existing-but-unconnected agents are never re-created
(AC-006).

### 4.3 Create-if-clear rule (T7)

Zero matches + the task target is unambiguous (role derivable from the task,
write set clear) → `create-agent` with a full role profile (§3.3). Return
`{decision: 'create', nodeId, roleProfileRef}` (AC-007).

### 4.4 Ask-user gate (T13, AC-008)

Zero matches + unclear target, or multiple matches with no dominant candidate,
or role not derivable → return `{decision: 'ask-user', ...}` and surface a
plain-language question to the user. No blind create/connect.

```json
{
  "decision": "ask-user",
  "question": "Which agent should do the UI review?",
  "candidates": [
    { "nodeId": "agent-3f9c", "displayName": "Frontend Expert", "roleTitle": "reviewer" },
    { "nodeId": "agent-7b1a", "displayName": "Code Reviewer", "roleTitle": "reviewer" }
  ]
}
```

### 4.5 Collaboration audit (AC-025, UX-4)

The audit is **derived, never stored separately**: the backend owns sessions,
bridge messages, and wakeup envelopes, so no separate audit table exists.

- `GET /api/workflow/cooperation/audit` derives entries from backend-owned
  data only: sessions with `displayName`/`roleTitle` (created whom + role),
  bridge messages grouped by `requestId` (asked / replied), and wakeup
  envelopes (wakeup dispatched, with the `goalNodeId` parsed from the
  envelope). No timeout data exists backend-side, so nothing is fabricated:
  the endpoint omits timeouts and its response carries a `note` stating that
  the UI derives the timed-out marker client-side.
- The UI audit view (TerminalDrawer) derives the same lines from
  `/api/sessions?all=1` + per-peer `/api/a2a/bridge-messages` reads. Timed-out
  is derived from real timestamps only: a request whose ask entry has no reply
  entry and whose last ask is older than a threshold (5 minutes) renders a
  `timed-out` marker.

Lines: `created <agent> as <roleTitle>`, `asked <peer>`, `replied <peer>`,
`wakeup dispatched <timerNodeId>`, `timed-out <requestId>`.

## 5. Structured Request Envelope (AC-009, AC-010, AC-019, AC-026; T14)

Extension of the bridge message envelope (`bridge-store.mjs`). Legacy plain
text payloads keep working unchanged (AC-026/T14): `data` remains the
plain-text body and the only terminal-delivered content.

```json
{
  "messageId": "msg-abc123",
  "requestId": "req-20260812-0001",
  "threadId": "thread-7",
  "replyTo": "msg-abc123",
  "topic": "wf-review",
  "deliveryMode": "direct",
  "source": "agent.directMessage",
  "fromSessionId": "sess-aaa",
  "toSessionId": "sess-bbb",
  "fromNodeId": "agent-ceo",
  "toNodeId": "agent-3f9c",
  "contextRefs": [ { "nodeType": "markdown", "nodeId": "markdown-2a1" } ],
  "data": "Please review and reply with evidence. (legacy text, T14)",
  "ts": "2026-08-12T09:01:00.000Z"
}
```

Rules:

- `requestId` — sender-generated; the sender reuses it across the request's
  messages (same `threadId`); receivers echo it in replies. Aggregation
  (AC-010) reads by `requestId` (and `threadId` for multi-hop threads).
- `replyTo` — set to the `messageId` being answered.
- `contextRefs` — **nodeId references only, never content** (AC-019). A
  request payload must never inline markdown bodies; it references Markdown
  nodes (§8) that the receiver reads through typed actions.
- There is no separate `payload` sub-object in the implemented envelope: all
  structured request fields (`requestId`, `threadId`, `replyTo`,
  `contextRefs`, `toRole`, `topic`) are top-level envelope fields. Implementers
  must not add a nested `payload` object.
- A sender may send a plain `{data}` payload with no structured fields; the
  envelope is recorded identically and the path is unchanged (AC-026).
- Broadcast: same envelope, `deliveryMode: 'broadcast'`, `recipientIndex` /
  `recipientCount` set per recipient; `requestId` shared.
- **Terminal input composition (F17/D14):** when a structured request is sent
  to a target, the PTY input is composed as a compact envelope prefix followed
  by the text, e.g.
  `[harness-request req-20260812-0001 to-role=implementer contextRefs=markdown-2a1] <text>`
  (prefix fields present only when set: `requestId` first, then `to-role`,
  then comma-joined `contextRefs` nodeIds). The recorded bridge `data` field
  remains the plain-text body; legacy text-only sends compose no prefix and
  keep the exact previous input. On receiving a `[harness-request ...]`
  envelope, the receiver replies via `sendMessage` with the SAME `requestId`
  (and `replyTo` set to the message id being answered) so the sender can
  aggregate the thread (agent manual "structured requests" example).

## 6. Timer Wakeup Protocol (D1, M4, M5; AC-011, AC-012, AC-015; T10, T11, T12)

### 6.1 Wakeup model (D1)

- Backend runs a **bounded scheduler loop** (interval loop active only while
  the server runs and the timer is enabled — no resident/infinite background
  scheduler). On each pass: `timer.tick` → due timers → `timer.fire` (both stay
  **backend-internal**; agents never invoke fire/tick) → dispatch a wakeup
  message into the message queues of the connected agent nodes. The
  **connected recipient set** (F13/D-union) is the magnetic-group members
  (capsuleDockLinks, "磁吸组内") **union** the ordinary graph-edge-connected
  members — graph edges from the timer node with an `event` or `control`
  relation ("连接") — deduped. Non event/control edges (e.g. `delegation`) do
  not extend the recipient set.
- **Bounded loop semantics (F14/D11):** the loop is server-lifetime and
  enable-gated, and a timer's own `loop.maxIterations` bounds how many times it
  advances: when `loop.runCount` reaches `maxIterations`, the scheduler stops
  advancing that timer and marks the loop complete (`loop.enabled=false` set
  through the event-node store API — never by mutating state files directly).
  `loop.stopOnFailure` marks the loop complete when a fire throws. Timers
  without a bounded loop keep the interval behavior; the scheduler still
  auto-stops when no enabled timers exist and stops on server close.
- Wakeup envelope (recorded in the bridge store with
  `deliveryMode: 'wakeup'`, `source: 'timer.wakeup'`):

```json
{
  "type": "wakeup",
  "messageId": "wake-0007",
  "timerNodeId": "timer-node-1",
  "goalNodeId": "goal-node-2",
  "scheduledAt": "2026-08-12T09:05:00.000Z",
  "firedAt": "2026-08-12T09:05:00.123Z",
  "intervalSeconds": 60
}
```

- `goalNodeId` is `null` when the magnetic group has no Goal node; when set,
  the agent must check the Goal state on wakeup (AC-012, T11).
- Agents read wakeup messages **on their next turn** (in-session check, e.g.
  via `agent.readMessages` with the wakeup filter or a dedicated
  wakeup-queue read). No agent polling loop is required.
- Agent-visible timer surface is configure only: `timer.configure`,
  `timer.enable`, `timer.disable`, `timer.setInterval`, `timer.setMode`
  (existing actions; M4). `timer.tick` / `timer.fire` remain backend-internal.
- **Goal node never wakes agents.** Wakeups come only from Timers.

### 6.2 Single-Goal-per-group rule (AC-015, T12)

A magnetic group (per `computeMagneticTopology`, `a2a-store.mjs`) that
contains a Timer and an Agent may contain at most one Goal node. Creating or
connecting a second Goal into such a group is rejected by the backend, and the
frontend must surface the rejection as a user-visible message. Rejection shape:

```json
{
  "error": "goal_already_bound",
  "message": "This group already has a Goal (goal-node-2) bound to its Timer (timer-node-1).",
  "existingGoalNodeId": "goal-node-2",
  "timerNodeId": "timer-node-1"
}
```

## 7. Goal Action Contract (AC-013, AC-014; T11)

Existing actions stay: `goal.read`, `goal.update` (metadata + planItems/
acceptance), `goal.requestCompletion`, `goal.returnToWork`, `goal.ackWatchdog`.
New item actions (all via `POST /api/workflow/nodes/:node/actions/<name>`):

| Action | Payload | Behavior |
|--------|---------|----------|
| `goal.add` | `{"planItems":[{"text":"...","status":"todo"}]}` or `{"acceptance":[{"text":"..."}]}` | Append items; new ids assigned; returns `{state, revision}` |
| `goal.delete` | `{"planItemIds":["P-002"]}` or `{"acceptanceIds":["AC-002"]}` | Remove items; unknown ids are ignored with a `skipped` list |
| `goal.replace` | `{"planItems":[...]}` or `{"acceptance":[...]}` | Full list replacement; ids of kept items preserved |
| `goal.check` | `{"planItemIds":["P-001"],"actorNodeId":"agent-3f9c"}` | Set item status `done`; records `updatedBy`/`updatedAt` |
| `goal.uncheck` | `{"planItemIds":["P-001"],"actorNodeId":"agent-3f9c"}` | Set item status back to `todo` |
| `goal.complete` | `{"evidenceRefs":["..."],"note":"..."}` | Set status `proposed-complete`; **succeeds only when every plan item is checked**; otherwise returns error below |
| `goal.reopen` | `{"note":"..."}` | Return status to `active` (same effect as `returnToWork`) |

Complete-when-all-checked (AC-014): `goal.check` that marks the last pending
item `done` leaves the Goal `active`; the agent then calls `goal.complete`
explicitly. `goal.complete` with pending items returns:

```json
{
  "error": "goal_items_pending",
  "message": "Complete all plan items before completing the Goal.",
  "remaining": ["P-003", "P-004"]
}
```

## 8. Markdown Blackboard Contract (AC-016..AC-019; T8, T9, M6)

Markdown nodes are the shared team context. Share by **nodeId only** in
request envelopes (§5 `contextRefs`); receivers read through typed actions.

### 8.1 Find

`GET /api/workflow/markdown/find?nodeId=&title=` (CLI
`workflow-node-action ... markdown.find`) returns `{matches: [{nodeId, title,
revision}]}`. Find by nodeId or title (AC-016, T8).

### 8.2 Lock / lease (AC-017, T9)

- `markdown.acquireLock` — payload `{"lockOwner":"agent-3f9c","ttlSeconds":30}`
  (default 30, max 300) → `{lockId, owner, acquiredAt, expiresAt, revision}`.
  An expired or absent lock is freely acquirable; an unexpired lock owned by
  another agent returns a lock-conflict error with `expiresAt`.
- `markdown.releaseLock` — payload `{"lockId":"...","lockOwner":"..."}`; no-op after expiry.
- Lease semantics: the lock auto-expires at `expiresAt`; a writer may renew by
  re-acquiring with its own `lockId` (owner match required).
- **Persisted lease (F18/D15):** the lock is written into the markdown node's
  backend-owned state file (`{lockId, holder, acquiredAt, expiresAt}` on the
  node state) and read back on load, so a server restart keeps the lease. TTL
  expiry is honored on every read; an expired record is treated as absent and
  is cleared by the next successful write.

### 8.3 Revision guard (AC-017, AC-018, M6)

`markdown.patch`, `markdown.append`, `markdown.replace` accept optional
`expectedRevision` (and `lockId`). When `expectedRevision` mismatches the
current revision, no write occurs; recoverable conflict shape:

```json
{
  "error": "markdown_conflict",
  "message": "Markdown changed since read (revision 4 -> 5). Reread, merge your changes, and retry.",
  "currentRevision": 5,
  "expectedRevision": 4
}
```

Write-while-locked (F18/D15): while a valid foreign lock is held, the lock is
**mandatory exclusion** — `markdown.patch`, `markdown.append`, and
`markdown.replace` are refused with the `markdown_locked` error EVEN IF the
caller supplies no `expectedRevision`, carrying the lock holder and expiry
(plus the revision fields when supplied) so the agent can decide whether to
wait, ask the holder, or acquire after expiry:

```json
{
  "error": "markdown_locked",
  "message": "Markdown is locked by agent-3f9c until ... . Reread, merge your changes, and retry.",
  "currentRevision": 5,
  "expectedRevision": 4,
  "holder": "agent-3f9c",
  "expiresAt": "2026-08-12T09:05:00.000Z"
}
```

When no lock exists, lockless writes stay compatible (no lock → no exclusion
needed) and the `markdown_conflict` revision guard applies unchanged.

Reread-and-retry guidance (AC-018): on `markdown_locked` / `markdown_conflict`,
reread (`markdown.read`), merge, re-acquire lock if needed, and retry with the
fresh `currentRevision`. Last-write-wins is forbidden while a lock or
`expectedRevision` is supplied.

## 9. Node Manual Unified Schema (AC-020..AC-023; MANUAL-1..4)

Applies to all 15 manuals under `Harness/a2a/skills/` (and byte-aligned
mirrors under `templates/common/Harness/a2a/skills/`).

### 9.1 Common field layout

| Field | Meaning | Required |
|-------|---------|----------|
| `schemaVersion` | integer, 1 | yes |
| `id` (`skillId`) | stable manual id, e.g. `workflow-agent-node` | yes |
| `nodeType` | node kind for node manuals: `agent` \| `goal` \| `timer` \| `markdown` \| `file` \| `diagram` \| `mcp-connector` \| `resource` \| `skill-group`; omitted for control-plane manuals (`workflow-node-actions`, `workflow-context`, `workflow-ontology`, `workflow-node-map`, `terminal-control`, `wf-ui-map`) | node manuals only |
| `summary` (`description`) | what the node is for; agent-facing plain language | yes |
| `capabilities` (`commands` + `controlSurface`) | table: action name → CLI command → JSON payload example | yes |
| `examples` | 1+ concrete agent examples with full payloads (see §9.3) | yes |
| `prohibitions` (`policy.denied` + explicit) | forbidden actions, incl. the state.json prohibition (§9.2) | yes |
| `environment` | env vars relevant to the node | optional |
| `triggers` | NL triggers, EN + zh | recommended |

### 9.2 Prohibition text (MANUAL-3, AC-022)

Every node manual must contain, verbatim:

> Never edit `Harness/a2a/**/state.json` directly — use typed actions.

### 9.3 Examples (MANUAL-4, AC-023)

Manual examples are **agent-facing only**: concrete CLI invocations with full
JSON payloads, written in plain operational language. No user-facing jargon
(no "broadcast", "A2A", "thread", "shared-context" vocabulary in examples).
Examples for the four cooperation nodes:

- agent: `send-agent-message --to <agentNodeId> --request-id req-1` with a
  plain objective.
- timer: `workflow-node-action --node <timerNodeId> --action timer.setInterval
  --payload '{"intervalSeconds":120}'` and note "when this timer fires, a
  wakeup message appears in your inbox; read it on your next turn".
- goal: `goal.add` / `goal.check` / `goal.complete` example sequence.
- markdown: `markdown.acquireLock` → `markdown.append` with `expectedRevision`
  → `markdown.releaseLock`, plus the conflict retry example.

### 9.4 Manual injection (MANUAL-2, AC-021)

When an agent node is connected to a node, the connected node's manual is
injected into the agent's context, so the agent always sees the manual for
what it is connected to.

## 10. Traceability

### 10.1 T1-T14 → contract

| Test | Validates |
|------|-----------|
| T1 | §2 decision flow steps 1-3 (understand → team-needed decision, AC-024 partial) |
| T2 | §2 steps 3-6 + §3 role profile (autonomous team organization, AC-024) |
| T3 | §2 steps 8-10 + §5/§7/§8 (full cooperation flow, AC-024) |
| T4 | §4.1 find query (AC-005) |
| T5 | §3.1/3.3 displayName + roleTitle on UI agent card (AC-003) |
| T6 | §4.2 auto-connect (AC-006) |
| T7 | §4.3 create-if-clear (AC-007) |
| T8 | §8.1 markdown find by nodeId/title (AC-016) |
| T9 | §8.2/8.3 lock + revision conflict (AC-017, AC-018) |
| T10 | §6.1 wakeup dispatch; no resident scheduler (AC-011) |
| T11 | §6.1 goalNodeId in wakeup + §7 check/complete (AC-012, AC-014) |
| T12 | §6.2 single-Goal rejection, backend + frontend (AC-015) |
| T13 | §4.4 ask-user gate, no blind create/connect (AC-008) |
| T14 | §5 legacy text payload unchanged (AC-026) |

### 10.2 AC-001..AC-026 → contract

| AC | Contract section |
|----|------------------|
| AC-001 | §3.4 profile written at create-agent |
| AC-002 | §3.4 profile injected into context/init prompt |
| AC-003 | §3.1/3.3 (UI card identity, T5) |
| AC-004 | §3.3 distinct roleTitle per team |
| AC-005 | §4.1 find filters |
| AC-006 | §4.2 auto-connect |
| AC-007 | §4.3 create-if-clear |
| AC-008 | §4.4 ask-user gate (T13) |
| AC-009 | §5 structured payload |
| AC-010 | §5 requestId/threadId aggregation |
| AC-011 | §6.1 wakeup dispatch, bounded scheduler |
| AC-012 | §6.1 wakeup carries goalNodeId |
| AC-013 | §7 goal action set |
| AC-014 | §7 complete-when-all-checked |
| AC-015 | §6.2 single-Goal-per-group (T12) |
| AC-016 | §8.1 find (T8) |
| AC-017 | §8.2/8.3 lock + revision guard (T9) |
| AC-018 | §8.3 conflict error shape + retry |
| AC-019 | §5 contextRefs nodeId-only |
| AC-020 | §9.1 unified manual schema |
| AC-021 | §9.4 manual injection on connect |
| AC-022 | §9.2 state.json prohibition |
| AC-023 | §9.3 agent examples, no jargon (MANUAL-4) |
| AC-024 | §2 decision flow (T1-T3) |
| AC-025 | §4.5 collaboration audit |
| AC-026 | §5 legacy text payload (T14) |

## 11. Contract Summary (one line per contract, for implementers)

- Role profile: `Harness/a2a/agent-roles/<nodeId>.md` + session fields; written
  at create-agent; injected into context; roleTitle canonical vocabulary with
  agentKind as lifecycle-only flag.
- Routing: find → 1 match = auto-connect, 0 = create-if-clear, ambiguous =
  ask-user; audit every decision.
- Envelope: bridge envelope + `requestId`/`threadId`/`replyTo`/`contextRefs`;
  `data` text stays legacy-compatible.
- Timer wakeup: bounded backend loop → `timer.fire` → wakeup envelope into
  agent queues; agents read next turn; fire/tick backend-internal.
- Single-Goal rule: one Goal per Timer/Agent magnetic group, `goal_already_bound`
  rejection shape.
- Goal actions: add/delete/replace/check/uncheck/complete/reopen;
  complete requires all checked, `goal_items_pending` otherwise.
- Markdown blackboard: find by nodeId/title; acquireLock/releaseLock lease
  (TTL 30s default); revision guard with `markdown_conflict` +
  `currentRevision`; share by nodeId only.
- Manuals: 15 manuals share one field layout; verbatim state.json prohibition;
  agent-facing examples in plain language.
