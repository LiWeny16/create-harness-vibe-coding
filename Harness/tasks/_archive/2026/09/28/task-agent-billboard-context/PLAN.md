# task-agent-billboard-context - PLAN

## Mini PRD

### Goal

Give connected Agents a compact, shared Billboard for short team updates such as what an Agent tried, what it learned, what to avoid, and what it recommends. Billboard is a presentation of the existing Markdown resource backend.

### Scope

- Add a Billboard presentation choice when creating a workflow resource node.
- Persist its presentation metadata while keeping the canonical component type `markdown` and the existing Markdown state, revisions, locks, and typed actions.
- Render non-empty Markdown lines as compact, readable one-line entries.
- Include the latest 20 Billboard lines in each connected Agent's canonical workflow context. A node must be connected with relation `shared-context` to be included.
- Keep direct A2A messages and broadcasts on the existing bridge path.

### Non-scope

- A second storage format, table, endpoint family, or A2A transport for Billboard.
- Automatically forwarding Billboard entries into a PTY prompt. Agents read the canonical workflow context API each turn.
- Changing normal Markdown node editing or rendering.

### User flow

1. Create a Billboard from the workflow resource picker.
2. Connect one or more Agent nodes to it using `shared-context`.
3. Append concise one-line Markdown entries through the existing `markdown.append` action.
4. Read the same latest entries in the Billboard node and in every connected Agent's workflow context.

Preferred entry shape: `<agentNodeId>/<agentName> tried <X>; result: <Y>; avoid: <Z>; recommend: <W>.` Omit fields that are unknown.

## Acceptance criteria

| ID | Given / When / Then | Evidence | Status |
|---|---|---|---|
| AC-001 | Given a Billboard resource, when it is created and read or appended through the existing component and Markdown actions, then the backend reports a Markdown component and uses the same Markdown state, revision checks, lock rules, and action endpoints as a normal Markdown node. No Billboard-only state store or action endpoint is created. | `workflow-agent-billboard.test.mjs`: create, read, append, stale revision, lock parity, and no Billboard-only action. | passed |
| AC-002 | Given two Agents connected to the same Billboard by `shared-context`, when either Agent reads `GET /api/workflow/context/:agent`, then both receive the same latest 20 non-empty Billboard lines with the node id and revision; an unconnected Agent does not receive them. An append is visible on the next read. | `workflow-agent-billboard.test.mjs`: connected A/B, unconnected C, append, and bounded entries. | passed |
| AC-003 | Given the workflow resource picker, when a user creates a Billboard and appends short lines through the existing Markdown action, then the canvas shows those lines as compact one-line entries and the request uses the existing Markdown backend API. A normal Markdown node keeps its existing editor presentation. | `workflow-billboard.spec.ts` passed against a real isolated `wf-ui` API server; captured requests and screenshot artifact. | passed |
| AC-004 | Given Agents use both communication forms, when they send a direct message or broadcast and append a Billboard note, then direct messages remain bridge envelopes while the durable shared note remains Markdown content referenced by node id. | Existing A2A communication/message suites and the new Markdown backed Billboard integration test: 13 tests passed. | passed |

## UI contract

| Element | Selector / accessible name | Behavior | AC |
|---|---|---|---|
| Resource picker action | `data-testid="workflow-create-billboard-node"`, button name `Billboard` | Creates a Markdown-backed Billboard at the selected canvas position. | AC-003 |
| Billboard node | `data-testid="workflow-billboard-node"` | Exposes backend source, node id, and current revision. | AC-001, AC-003 |
| Billboard entry | `data-testid="workflow-billboard-entry"` | One non-empty source line per compact row; long text clips visually but remains available to assistive technology. | AC-003 |
| Normal Markdown node | Existing `data-testid="workflow-component-node"` and `data-component-type="markdown"` | Retains the current Markdown editor. | AC-003 |

## API contract

| Operation | Contract | AC |
|---|---|---|
| Create | `POST /api/workflow/nodes` with `{type:"markdown", presentation:"billboard", title, position}`; response node keeps `type:"markdown"` and carries `presentation:"billboard"`. | AC-001, AC-003 |
| Read / append | Existing `POST /api/workflow/nodes/:nodeId/actions/markdown.read` and `markdown.append`; standard revision and lock behavior applies. No Billboard-specific action. | AC-001, AC-003 |
| Agent context | Existing `GET /api/workflow/context/:agentNodeId`; adds `context.sharedBillboards[]` with `{nodeId,title,revision,entries}` for connected Billboard Markdown nodes whose edge relation is `shared-context`. `entries` contains the latest 20 non-empty lines in source order. | AC-002 |
| A2A bridge | Existing `agent.sendMessage`, `agent.broadcastMessage`, and `agent.readMessages` contracts remain unchanged; message `contextRefs` remain node-id references. | AC-004 |

## Test plan

- RED first: AC-linked backend API tests for canonical Markdown storage/actions and connected-context visibility, plus a Playwright picker/render test; confirm each fails for the expected missing Billboard behavior.
- GREEN: implement only after the RED evidence is recorded.
- Backend: `node --test src/wf-ui-server/__tests__/workflow-agent-billboard.test.mjs` and the focused A2A communication/message suites.
- UI: `pnpm --dir src/ui exec playwright test e2e/workflow-billboard.spec.ts` with a unique `WF_UI_E2E_PORT`.
- Build: `pnpm --dir src/ui run typecheck` and `pnpm --dir src/ui run build`.
- Coverage: neither the root nor `src/ui/package.json` configures a coverage threshold or coverage command; no ECC testing rule file is present in the checked skill/rule directories. The AC-focused backend integration and real-browser tests are the configured verification gates for this change.
- API evidence: use the local `wf-ui` HTTP API. Do not use Browser Neo for control.

## Scope and ownership

- Write set: `src/wf-ui-server/component-node-store.mjs`, `src/wf-ui-server/workflow-node-runtime.mjs`, `src/wf-ui-server/workflow-agent-context.mjs`, A2A context/Markdown manuals, `src/ui/src/components/WorkflowRoute.tsx`, `WorkflowComponentNode.tsx`, `src/ui/src/components/workflow/nodeRegistry.tsx`, `src/ui/src/components/workflow/nodeRuntimeClient.ts`, the Billboard presentation component/styles, focused tests, and this task capsule.
- Forbidden: direct edits to `Harness/tasks/task-upgrade-harness-092/STATE.json`, direct edits to backend-owned component state, and unrelated existing dirty files.

## Decisions

| # | Decision | Reason | Date |
|---|---|---|---|
| 1 | Billboard uses canonical Markdown type/state/actions and adds only presentation metadata plus a bounded context projection. | User specified that Billboard and Markdown differ in form while backend implementation remains the same. | 2026-09-28 |
| 2 | Only `shared-context` edges expose Billboard entries to an Agent context. | Makes membership explicit and avoids leaking notes to unconnected Agents. | 2026-09-28 |
| 3 | Context includes the latest 20 non-empty lines. | Keeps connected context useful and bounded. | 2026-09-28 |

## Risks

| Risk | Mitigation | Status |
|---|---|---|
| Presentation metadata could accidentally fork Markdown storage or actions. | Assert canonical `type: markdown`, same action IDs, state revision, lock, and conflict behavior. | mitigated by AC-001 |
| Context could grow without bound or leak to unconnected Agents. | Include only the latest 20 non-empty lines on explicit `shared-context` edges; test an unconnected Agent. | mitigated by AC-002 |
| Compact rows could hide long content. | Keep full text accessible to assistive technology and preserve the canonical Markdown read action. | mitigated by AC-003 and existing Markdown read |
