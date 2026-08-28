# task-agent-team-cooperation-layer - PLAN

## Goal

Implement generic Agent Team Cooperation Layer — user gives natural-language request; when `/wf`, `$wf`, `/wf-max`, `$wf-max` is explicit, the main Agent node understands the task, organizes a team, creates/connects sub Agent nodes, assigns roles, shares context, waits for replies, continues. NOT bound to "Claude asks Codex" as the only scenario.

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| D1 | Timer wakeup model: message-queue + in-session check. Backend timer fires and dispatches wakeup messages (with Goal node refs) into agent message store; agent reads them when active/next turn. | No resident/infinite background scheduler. | 2026-08-12 |
| D2 | Delivery scope: FULL this run — Spec + Backend + Prompt + UI + Tests, incl. UI agent node card displayName/roleTitle (ROLE-3/T5), collaboration audit view (UX-4), T12 frontend rejection of second Goal, Playwright coverage. | User confirmed full delivery. | 2026-08-12 |
| D3 | Cross-runtime: role profiles fully support runtime/provider fields + query filtering; tests only spawn real agent sessions on current runtime (claude); codex/opencode covered via metadata + injected scenarios. | Runtime portability without flaky real-session tests. | 2026-08-12 |
| D5 | Task-local agent-cap override to 20 approved by user (2026-08-12); WF-MAX total cap 15 insufficient for full delivery | Full delivery scope | 2026-08-12 |
| D6 | AC-025 audit: backend-derived endpoint + client timeout derivation + spec 4.5 amendment | User review resolution | 2026-08-12 |
| D7 | Budget: user accepts ~25 agents (3 wasted by manager-chain failure); continue verifier+reflector | User decision | 2026-08-12 |
| D8 | Commit: after verify+reflect PASS, commit ONLY this task deliverable files to a NEW branch | User decision (superseded by R4: commit deferred until fixes verified) | 2026-08-12 |
| D9 | Accept known gaps (e2e toast paths, settings save, T3 full-flow) — later superseded by D17 | User decision | 2026-08-12 |
| D10 | wakeup set = magnetic group ∪ graph-edge-connected agents (R4 H2) | User review | 2026-08-12 |
| D11 | scheduler honors loop.maxIterations/stopOnFailure; server-lifetime bounded; no global daemon (R4 M3) | User review | 2026-08-12 |
| D12 | role profile written BEFORE init prompt assembly; init text carries identity (R4 M4) | User review | 2026-08-12 |
| D13 | manual injection covers ALL manual-having node types; schema test covers all (R4 M5) | User review | 2026-08-12 |
| D14 | structured request input = compact envelope prefix + text; manuals teach reply-with-requestId (R4 M6) | User review | 2026-08-12 |
| D15 | markdown lock persisted to node state; foreign active lock rejects writes even without expectedRevision (R4 M7) | User review | 2026-08-12 |
| D16 | connectNodes graph-action path enforced with assertSingleGoalPerGroup (R4 H1) | User review | 2026-08-12 |
| D17 | T3 full-flow integration test added (R4 M8) | User review | 2026-08-12 |
| D4 | Task relationship: build directly on current working tree, which already contains task-standardize-workflow-nodes W41 code (agent.sendMessage/broadcastMessage/readMessages, node manuals, Timer/Goal nodes). This task owns the Timer wakeup / Goal actions / team routing / role profile slices. Standardize open follow-ups (F2/F4-F7) do not block. links.dependsOn = [] (code already merged into tree; no gate wait). | No dependency gate wait. | 2026-08-12 |

## Scope / Non-Goals

In scope:
- Timer wakeup (message-queue + in-session check), Goal actions, team routing, role profile slices, UI agent identity, WF/WF-MAX team-organization prompts, T1-T14 tests.

Non-goals (user spec section 十):
- No A2A jargon for users.
- No remote A2A protocol server.
- No infinite background scheduler.
- No bypassing backend-owned state.
- No hard-coding Claude/Codex as the only scenario.
- Goal node never wakes agents itself.

## Acceptance Criteria

AC source: user spec tables (二 role standard, 五 manual standard, 六 markdown, 七 timer/goal, 八 backend interface, 九 tests) + D1-D4.

| ID | Criterion (user spec ref) | Evidence | Status |
|----|---------------------------|----------|--------|
| AC-001 | create-agent writes role profile: displayName, roleTitle, responsibility, runtime/provider, capabilities, roleProfileRef (ROLE-1) | backend test: agent session record + `Harness/a2a/agent-roles/<nodeId>.md` written | pending |
| AC-002 | agent init/context prompt strongly injects its own role profile (ROLE-2) | test asserts init prompt contains roleProfileRef content | pending |
| AC-003 | UI agent node card displays displayName + roleTitle (ROLE-3, UX-5, T5) | Playwright asserts card text | pending |
| AC-004 | creating/copying sub-agents auto-assigns distinct roles (ROLE-4) | backend test: two creates → distinct roleTitle | pending |
| AC-005 | find agent by role/runtime/provider/capability/title (八) | backend test: filter queries return matches | pending |
| AC-006 | existing-but-unconnected target agent gets auto-connected (T6) | backend test: connect invoked, edge created | pending |
| AC-007 | no existing agent + clear task → create target agent (T7) | backend test: create invoked with role profile | pending |
| AC-008 | ambiguous target → agent asks user, no blind create/connect (T13) | prompt/context test: ambiguous case returns ask-user decision | pending |
| AC-009 | structured request payload (request id, role, context refs) not just terminal text (八) | backend test: sendAgentMessage with structured payload, aggregated replies (T14 compat with legacy text payload) | pending |
| AC-010 | replies aggregated per request/thread (八) | backend test: read per request id | pending |
| AC-011 | timer dispatch wakeup messages to connected/magnetic-group agents; no resident scheduler (七, T10) | backend test: timer fire → wakeup messages in agent queues | pending |
| AC-012 | wakeup message references Goal node; agent checks Goal on wakeup (七, T11) | backend test: wakeup envelope carries goalNodeId | pending |
| AC-013 | goal add/delete/replace/check/uncheck/complete/reopen actions (八) | backend tests per action | pending |
| AC-014 | agent ticks goal items and calls complete when all done (七, T11) | backend test: complete after all checked | pending |
| AC-015 | max one Goal per Timer/Agent magnetic group; second Goal rejected by backend AND frontend with user message (七, T12) | backend test + Playwright toast assertion | pending |
| AC-016 | markdown findable by nodeId/title (六, T8) | backend test: find markdown node | pending |
| AC-017 | markdown lock/revision-lease on write; concurrent writes do not overwrite (六, T9) | backend test: two writers → second gets conflict error | pending |
| AC-018 | conflict returns recoverable error; agent rereads and retries (六) | test: conflict payload carries current revision | pending |
| AC-019 | shared context passed by nodeId only (六) | test: request payload refs nodeId, not content | pending |
| AC-020 | unified manual schema per node type (MANUAL-1) | schema test on Harness/a2a/skills/*.json | pending |
| AC-021 | agent context injects connected node's manual (MANUAL-2) | context test: manual text present after connect | pending |
| AC-022 | manuals forbid direct editing of Harness/a2a/**/state.json (MANUAL-3) | test: manual text contains prohibition | pending |
| AC-023 | manuals give agent examples, no user-facing jargon (MANUAL-4) | review of manual copy | pending |
| AC-024 | WF/WF-MAX prompt enables autonomous team organization (decision flow steps 1-10, UX-1/2) (T1, T2, T3) | prompt test: NL request → team plan decision | pending |
| AC-025 | collaboration audit visibility: created whom/role, asked whom, replied, timed out (UX-4) | UI/API surface test | pending |
| AC-026 | T14: legacy sendMessage/text payload still compatible | backend test: legacy text payload path unchanged | pending |

## Subagent Dispatch

D-GATE table. Tier: WF-Full (cross-layer backend+UI+prompts+tests, browser acceptance). Fan-out: WF-Max-Useful.

W0 findings driving write sets: session record has role/model/provider but NO displayName (session-registry.mjs:90-147); no find-agent query; bridge envelope lacks threadId/requestId (bridge-store.mjs:57-91); timer fire/tick exist but no scheduler + denied to agents (workflow-ontology.mjs:334); goal has only read/update/requestCompletion (goal-node.mjs); no markdown lock (component-node-store.mjs:193 revision only); no single-goal-per-group validation (a2a-store.mjs:1801); 15 node manuals mirrored byte-aligned under templates/common/Harness/a2a/skills/ (check:mirrors + anti-drift).

| Wave | Worker | Role | AC IDs | Write set (disjoint) | Verification |
|------|--------|------|--------|----------------------|--------------|
| W1 | S1 spec+doc | spec writer | AC-001..026 (traceability), UX-1, AC-023 | `Harness/specs/cooperation/agent-team-cooperation-spec.md` (new; unified schemas: role profile, message envelope, manual schema, markdown lock protocol, timer wakeup protocol, goal actions + single-goal rule, T1-T14 traceability), `CLAUDE.md` (team-cooperation section: decision flow 1-10, no jargon), `.claude/rules/ecc/common.md`, `templates/common/CLAUDE.md` + `templates/common/.claude/rules/ecc/common.md` mirrors (byte-aligned) | spec exists; CLAUDE.md sections present; mirrors byte-identical |
| W2a | B1 role profile + context | implementer | AC-001, AC-002, AC-021, AC-022, AC-024 (partial), T1, T13 | `src/wf-ui-server/workflow-node-types/role-profile-store.mjs` (new), `src/wf-ui-server/session-registry.mjs`, `src/wf-ui-server/workflow-agent-context.mjs` (profile in context, manual injection, decision-flow prompt, ask-user gate), `src/wf-ui-server/__tests__/workflow-role-profile.test.mjs` (new) | `node --test src/wf-ui-server/__tests__/workflow-role-profile.test.mjs` + related targets |
| W2a | B2 routing + CLI | implementer | AC-005, AC-006, AC-007, AC-015 (backend part), T4, T6, T7 | `src/wf-ui-server/a2a-store.mjs` (findAgents by role/runtime/provider/capability/title + auto-connect helper + single-goal-per-magnetic-group check), `src/wf-ui-server/server.mjs` (POST create-agent writes role profile; GET /api/workflow/agents/find; goal-create cap validation), `Harness/scripts/wf-ui-control.mjs` (find-agent, agent-role-profile, structured-request flags, timer-wakeup control commands), `src/wf-ui-server/__tests__/workflow-agent-routing.test.mjs` (new) | `node --test` on new test + CLI smoke |
| W2a | B3 structured messages | implementer | AC-009, AC-010, AC-019, AC-026 (T14), T14 | `src/wf-ui-server/bridge-store.mjs` (threadId/requestId/replyTo on envelope), `src/wf-ui-server/workflow-node-types/agent-node.mjs` (structured payload on sendMessage/broadcastMessage, readMessages aggregation by requestId, legacy text payload compat), `src/wf-ui-server/__tests__/workflow-agent-messages-structured.test.mjs` (new) | `node --test` on new test |
| W2a | B4 timer wakeup | implementer | AC-011, AC-012, T10, T11 (backend part) | `src/wf-ui-server/timer-wakeup-scheduler.mjs` (new; bounded interval loop → timer.fire → dispatch wakeup messages to connected/magnetic agents w/ goal refs; no resident infinite scheduler), `src/wf-ui-server/workflow-node-types/timer-node.mjs` (wakeup dispatch action), `src/wf-ui-server/workflow-ontology.mjs` (agent permission for configure; fire/tick stay internal), `src/wf-ui-server/workflow-event-node-store.mjs` (scheduler hooks), `src/wf-ui-server/__tests__/workflow-timer-wakeup.test.mjs` (new) | `node --test` on new test |
| W2a | B5 goal actions | implementer | AC-013, AC-014, T11 (backend part) | `src/wf-ui-server/workflow-node-types/goal-node.mjs` (add/delete/replace/check/uncheck/complete/reopen + complete-when-all-checked), `src/wf-ui-server/__tests__/workflow-goal-actions.test.mjs` (new) | `node --test` on new test |
| W2a | B6 markdown lock | implementer | AC-016, AC-017, AC-018, T8, T9 | `src/wf-ui-server/workflow-node-types/markdown-node.mjs` (find/section + acquireLock/releaseLock + revision guard on patch/append/replace with recoverable conflict error), `src/wf-ui-server/component-node-store.mjs` (lock state + optimistic-concurrency compare), `src/wf-ui-server/__tests__/workflow-markdown-lock.test.mjs` (new) | `node --test` on new test |
| W2b | P1 manuals | implementer | AC-020, AC-023, AC-022, MANUAL-1..4, T8 (manual) | `Harness/a2a/skills/workflow-agent-node.json`, `workflow-goal-node.json`, `workflow-timer-node.json`, `workflow-markdown-node.json`, `workflow-node-actions.json`, `Harness/a2a/role-graph.json` (role vocabulary note) + byte-aligned mirrors `templates/common/Harness/a2a/skills/*` + `templates/common/Harness/a2a/role-graph.json`, `src/wf-ui-server/__tests__/workflow-node-manual-schema.test.mjs` (new) | schema test + `node scripts/check-update-mirrors.mjs` |
| W2c | U1 agent card | implementer | AC-003 (T5), AC-025 (partial), UX-5 | `src/ui/src/WorkflowRoute.tsx` (agent card shows displayName+roleTitle; audit chip), no testid removals | `pnpm --dir src/ui exec tsc --noEmit`; UI build |
| W2c | U2 settings+create panel | implementer | AC-003 (create path), ROLE-4 (UI part), UX-4 | `src/ui/src/workflow/AgentNodeSettings.tsx`, `src/ui/src/WorkflowFloatingPanel.tsx` (role/displayName fields in create panel; KEEP testids workflow-create-node, workflow-create-node-panel, workflow-agent-kind, workflow-agent-mode, workflow-create-agent-submit), `src/ui/src/workflow/nodeRegistry.tsx` | typecheck + anti-drift test |
| W2c | U3 goal/timer UI + audit | implementer | AC-003 (partial), AC-015 (frontend part/T12), AC-025, UX-4 | `src/ui/src/WorkflowGoalNode.tsx`, `WorkflowGoalExpandedNode.tsx` (item actions UI; second-Goal rejection toast), `src/ui/src/WorkflowEventNode.tsx`, `WorkflowTimerExpandedNode.tsx` (wakeup/audit state), `src/ui/src/TerminalDrawer.tsx` (audit: created/asked/replied/timed-out), toast util file under `src/ui/src/**` if present | typecheck + UI build |
| W2c | U4 e2e spec | test-writer | AC-003/T5, AC-015/T12 (frontend), AC-025/UX-4 | `src/ui/e2e/wf-ui-m7-team-cooperation.spec.ts` (new; Playwright: agent card identity, second-Goal rejection toast, audit lines) | `npx playwright test src/ui/e2e/wf-ui-m7-team-cooperation.spec.ts` |

Wave order: W1 spec → W2a backend (B1-B6, parallel, disjoint) → W2b manuals (P1) → W2c UI (U1-U4, parallel, disjoint) → W2R review-manager (spec/backend/prompt + UI reviewers) → verifier → reflector.

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| M1 | Full-suite Playwright env flakiness (tracked on standardize task) | Keep focused specs small; run per-spec | open |
| M2 | anti-drift + check:mirrors enforce literals/template parity | Implementers instructed: never remove testids; byte-aligned mirrors | open |
| M3 | Two role vocabularies (CLI 'Main Agent'/'Subagent' vs session 'terminal-agent') | Spec defines unified roleTitle vocabulary; create-agent path normalized | open |
| M4 | timer.fire/tick denied to agents (ontology) | Scheduler is backend-internal; agent-visible surface = configure + wakeup messages only | open |
| M5 | No resident scheduler (D1) | Scheduler bounded: interval loop only while server runs + timer enabled; wakeup via message store | open |
| M6 | Last-write-wins markdown today | Lock/revision guard per AC-017; conflict returns current revision | open |
