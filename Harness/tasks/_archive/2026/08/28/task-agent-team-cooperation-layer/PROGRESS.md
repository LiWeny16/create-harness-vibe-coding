# task-agent-team-cooperation-layer - PROGRESS

## Current

- Phase: Archived
- Next: commit decision (user D8).

## Review + Verification (W2R/VER/REF)

- W2R review: R1 spec/AC PASS-conditional (AC-004 no test; AC-025 endpoint missing; spec 5 example drift); R2 backend FAIL (MAJOR: timer.dispatchWakeup/fire/tick reachable by any actor; single-goal count pre-connect false negative; actor-omission bypass; MINOR: stopServer never stopped scheduler; findAgents ignored capsuleDockLinks; NIT: lock-held write shape); R3 UI PASS (LOW: api.ts token drop; EventNode empty-fired cosmetic; audit heuristic). review-manager fanout degraded (nested chain returned nothing) -> CEO direct dispatch recorded in STATE D-note.
- FX fix wave (F1-F11, all landed): F1 timer-internal action gate (HTTP actor options -> subagent/unknown 403; scheduler on internal path); F2 candidate-inclusive single-goal count (create/connect 409 goal_already_bound spec shape); F3 actor hole scoped to F1 set + documented (legacy UI path unchanged); F4 stopTimerScheduler on server close; F5 findAgents connected includes capsuleDockLinks + role-match precedence; F6 nextAvailableRole per-parent distinct roles (AC-004); F7 GET /api/workflow/cooperation/audit (derived, no fabrication) + client timed-out derivation (5min) + spec 4.5 amended; F8 api.ts token restored; F9 EventNode hide empty fired; F10 spec 5/8.3 aligned; F11 enforcement tests 7/7.
- VER (clean run): backend 464/0; UI tsc + build PASS; anti-drift 21/21; m7 3/3, m4-timer 8/8 (0 retries); check-update-mirrors only pre-existing release-state failures; git diff --check clean. AC-001..026 all evidenced; T1-T14 covered.
- REF: ACCEPT-WITH-RECORDED-RISKS, reflector PASS conditional. Known gaps (D9): e2e toast paths (goal_items_pending/markdown_conflict), AgentNodeSettings save, T3 full-flow test, AC-025 backend audit derivation has NO test (e2e mocks bridge routes) - MED. Pre-existing: check-update-mirrors release 404s (task-release-0819-formal blocked); M1 env flakiness. Budget: ~25 agents vs approved 20 (D7 accepted; 3 wasted by manager-chain failure).
- Commit: strategy pending user decision (A whole-batch / B by-file / C hunk-pick).

## Wave Progress

- W1 Spec: Harness/specs/cooperation/agent-team-cooperation-spec.md (11 sections, contracts for role profile/envelope/timer-wakeup/goal/markdown-lock/manuals) + CLAUDE.md + ECC + template mirrors byte-identical. Done.
- W2a Backend (B1-B6, 6 workers): role-profile-store + session displayName/roleTitle (AC-001/002/021/022); find/auto-connect/create + single-goal-per-group 409 (AC-005/006/007/015); structured requestId/threadId/contextRefs + T14 compat (AC-009/010/019/026); timer-wakeup bounded scheduler deliveryMode wakeup (AC-011/012); goal add/delete/replace/check/uncheck/complete/reopen + goal_items_pending (AC-013/014); markdown find/acquireLock/releaseLock + revision guard markdown_conflict (AC-016/017/018). Full backend suite 438/438.
- I2 Integration: agent-visible permission gates for goal.*/markdown.*; HTTP error bodies forward remaining/currentRevision/expectedRevision/holder/expiresAt/existingGoalNodeId/timerNodeId. Full suite 457/0.
- P1 Manuals: unified schema 5 manuals + role-graph roleVocabulary + byte-identical template mirrors; schema test 14/14 (AC-020/022/023/024).
- PARITY: wf-ui-control.mjs template mirror synced; spec 8.2 lockOwner fixed; anti-drift 21/21.
- BP: snapshot workflow.nodes + persisted graph nodes + config summary forward displayName/roleTitle; markdown capabilities += find/acquireLock/releaseLock (AC-003 runtime path, AC-021). Full suite 457/0.
- W2c UI: U1 card identity (displayName title + roleTitle chip, legacy fallback); U1b create-form identity fields (testids workflow-create-agent-display-name/-role-title/-responsibility/-capabilities); U2 settings panel (7 role presets + custom, roleProfileRef read-only); U3 goal item actions UI + T12 goal_already_bound toast (api.ts error extraction) + timer wakeup strip + TerminalDrawer Cooperation audit panel. typecheck/build/anti-drift 21/21; Playwright m4-timer 8/8, m3 goal 5/5, m4-interactions 6/6.
- U4 e2e spec (wf-ui-m7-team-cooperation.spec.ts): in flight.

## Verification

### E2E Acceptance Suite (E0-E18)

- L1 Deterministic E2E: `control-plane-acceptance.test.mjs` — **43/43 PASS** (A1-A8, T1-T8, N1-N15, P1-P6, E0-E18, E1 chain)
- L2 CLI E2E: `control-plane-cli-smoke.test.mjs` — **12/12 PASS** (9 smoke + 1 Full-Chain E0-E18 + 2 util)
- Total: **55/55 PASS**
- Evidence matrix: `Harness/tasks/task-agent-team-cooperation-layer/E2E-EVIDENCE-MATRIX.md`
- E0 (clear map), E7 ($wf-max fanout), E18 (final summary) — new additions, all passing
- CLI Full-Chain: blank→clear→create Main Agent→3 subagents→connect→1:1+1:many messages→markdown→goal→aggregate — proven through real `wf-ui-control.mjs` subprocess

### Previous Verification

- Backend: 464/0
- UI tsc + build: PASS
- Anti-drift: 21/21
- m7: 3/3, m4-timer: 8/8 (0 retries)
- Playwright: m4-timer 8/8, m3 goal 5/5, m4-interactions 6/6

## Decisions

- D1: Timer wakeup = message-queue + in-session check; no resident/infinite background scheduler.
- D2: FULL delivery — Spec + Backend + Prompt + UI + Tests (incl. ROLE-3/T5, UX-4, T12, Playwright).
- D3: Role profiles carry runtime/provider fields + query filtering; real agent sessions only on claude; codex/opencode via metadata + injected scenarios.
- D4: Builds on current tree with standardize W41 code; dependsOn = []; F2/F4-F7 non-blocking.
