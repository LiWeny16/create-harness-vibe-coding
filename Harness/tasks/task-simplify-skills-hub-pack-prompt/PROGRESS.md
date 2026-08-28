# task-simplify-skills-hub-pack-prompt - PROGRESS

Compact heartbeat.

## Current

- Phase: Implementation
- Next: integrate 5 W2 Workers (W2a scan roots, W2b pack prompt, W2c context merge, W2d overlay simplify, W2e market unwire) → W3 tests + review + verify
- Blocker: none

## Fan-out record

- fanoutAttempted: true (2026-08-25, claude / Agent-tool native subagent channel)
- Mode: WF-Max-Useful
- Runtime: claude (Claude Code)
- W0/W1 dispatch (3 parallel read-only agents): architect (pack prompt + context merge seam), codebase-explorer (overlay change sites), codebase-explorer (route wiring + market unwire sites). All read-only, disjoint read sets.
- **W0/W1 integrated (2026-08-25):**
  - Architect: `prompt` is additive (no STATE_MISMATCH — `getCapabilityNode` only checks type+revision). Add `normalizePrompt` in capability store + `prompt` in `skillGroupStateFor`(:297) + project in `capabilityStateRefs`(:603)/`capabilityNodeStates`(:637) + `skill-group-node.mjs` read(:28)/configure(:77-86). Context seam: `connectedCapabilityNodeRefs` already spreads per-node state; add `prompt` at ~:1217 and derived `promptText` in `effectiveSkillGroupsFor`(:1235), already returned at :1699. Cap prompt ~280 chars. No path/body leak.
  - Overlay explorer: dead Add/checkbox at :396-445 (hub mode stages draftSkillIds only); Context JSON block :551-569 (empty in hub); Market tab body :573-637, tab type :23/:125/:151; drag chip `startDraftDrag` :263-271 / `startSkillDrag` :273-281; canvas consumer WorkflowRoute :752,:758.
  - Route/market explorer: overlay mount :9805-9833 (onSetSkillEnabled undefined in hub, onInstallPack :9823); create-pack reuses `handleCanvasDrop` skill-group branch :6901-6922 → `createSkillGroupAtPosition` :6400-6503 (auto capability edge :6454-6478). Market unwire list: server.mjs :110,:1467-1495 + module file; nodeRuntimeClient.ts :184,205,738-754; WorkflowRoute.tsx :142,:4070-4074,:4559-4576,:6355,:6359,:6528-6589,:8267-8320,:8499,:8511-8521,:8593-8597,:8631-8675; overlay :23,:96,:125,:151,:573-640,:1064. **Tests that break**: `__tests__/workflow-skills-market.test.mjs` (delete/rewrite), `e2e/wf-ui-m4-w38.spec.ts:816` (+route mock :587-592), `e2e/wf-ui-skills-hub-drag.spec.ts` (inert mock :409-411, clean helpers :21,:94-98,:331).
  - Docs to sync: `Harness/project/architecture.md` §3.4/§3.9 (capability-node state contract + agent-context shape).

## Verification

- [ ] AC-001 root scan (unit + manual node call)
- [ ] AC-002 family grouping (server + UI e2e)
- [ ] AC-003 pack prompt field (store + node type test)
- [ ] AC-004 context merge (agent-context test)
- [ ] AC-005 overlay single action (e2e)
- [ ] AC-006 Market unwired (grep + build)
- [ ] AC-007 build + full test suite green

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-08-25 | intake | Capsule created; on-disk skill paths verified (opencode=~/.config/opencode/skills; pi/copilot absent) |
| 2026-08-25 | D-GATE | Dispatch table + ACs + disjoint claims written to PLAN |
