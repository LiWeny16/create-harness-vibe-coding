# task-upgrade-harness-092 - PROGRESS

## Heartbeat

- Phase: Validation
- Owner: parent model is the sole main controller and final approver; task-scribe owns this capsule; Luna workers implement/verify/review within explicit claims and do not edit source outside them.
- Gate: `implementation-fix/independent-verify` (the former `w2-red` gate is historical).
- Next: independently verify the repaired composition/backend/frontend slice,
  then review the actual W6 candidate tree/snapshot; all AC remain pending
  until exact-SHA/fresh-install and post-push benchmark gates are actually
  satisfied.
- Blocker: uncovered original ACs, exact-SHA/fresh-install/release
  provenance, state-freshness/recovery, automatic routing/context freshness,
  measured memory quality, and standards-level A2A evidence remain open. Do
  not claim AC implementation complete.

## Durable handoff

- Canonical task: `Harness/tasks/task-upgrade-harness-092/STATE.json`; active pointer now targets this task. Original `task-make-wf-lifecycle-0908` remains open and unmodified.
- Ready queue: none; running: `W6-CANDIDATE-CHECKS` (`/root/fix_runtime_review_092`); done: `W0-PLAN`, `W0-EXTERNAL`, `W0-RUNTIME`, `W1-ARCH`, `W2-CONTRACT`, `W2-CORE-RED`, `W2-RUNTIME-RED`, `W2-BACKEND-TEST`, `W3-CONTEXT`, `W3-WORKFLOW-DOCS`, `W3-RUNTIME`, `W3-VERIFY-CONTEXT-MEMORY`, `W3-REVIEW-RUNTIME`; pending: fresh-install benchmark after candidate checks. The old REDs remain in the dated log/evidence only.
- Hard constraints: preserve existing dirty tree, `3080.md/png`, `Harness/a2a/**`, and unrelated tasks; no reset/clean/checkout; no npm publish.
- Release benchmark: fresh directory installs exact GitHub candidate SHA/pack hash; fresh Luna executes controller-designed probes, independent Luna scores, holdout remains untouched; provider token/cost unavailable = `unknown`.
- Fresh-install provenance: use an isolated checkout of the exact pushed SHA to build/pack and record archive hash/environment, or prove every installed package byte came from that SHA; a dirty-tree `npm pack` plus remote SHA is insufficient.
- Ownership correction: the parent model, not Luna, is the controller; W6 is a Luna release worker and requires parent-model final approval before any release operation.

## Verification so far

> The intake/RED entries below are retained as historical evidence. Where a
> later repair or independent review superseded them (including W2, B4 wait,
> and the old runtime verifier wording), the dated Current checkpoint above is
> the authoritative current fact.

- [x] `node Harness/scripts/task-state.mjs record ... --create --apply --json` created task.
- [x] `node Harness/scripts/task-state.mjs set-active task-upgrade-harness-092` updated canonical focus/index without closing prior tasks.
- [x] Baseline read: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, `WF.md`, `WF-STATE.md`, `subagents.md`, templates, package/version, README/changelog, git status/diff.
- [x] `node Harness/scripts/task-state.mjs query task-upgrade-harness-092 --json`: `ok:true`, count 1, active/plan, no query warnings.
- [x] `node Harness/scripts/task-state.mjs validate --json`: `ok:true`, errors 0; expected warning only for six outer tasks vs displayed cap five.
- [x] `git diff --check`: no whitespace errors; pre-existing CRLF normalization warnings only.
- [x] Frozen business contracts and pre-registered benchmark written in `CONTRACTS.md` and `BENCHMARK.md`; W1 marked done and W2 marked running.
- [x] Backend ensure RED: `node --test tests/wf-backend-ensure.test.js` — 3 tests fail because `ensure-backend` CLI is not yet implemented; this is the expected product RED.
- [x] Runtime RED additions: `node --test src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs` — 7 tests, 3 baseline pass and 4 contract RED (context consumption/boundary, lost PTY recovery, cancel terminal route).
- [x] Workflow/docs integration: all 17 command routes audited; command/skill/spec/template mirrors synchronized; `node --test tests/generator.test.js` — 38/38 pass; intelligence policy — 4/4 pass; `node Harness/scripts/context-budget.mjs --json` — 4/4 pass; `node Harness/scripts/validate-harness.mjs --json` — pass with existing missing-task and six-task-cap warnings.
- [x] Context: the original seven independent findings are 7/7 passed; three new REDs remain (`path/url`, immutable `intent.original`, `partialscope`), while author-side checks are 71/71 GREEN and fresh `verify_integration_092` re-verification is running.
- [x] Runtime review: 14 independent checks are 10 pass / 4 RED — unbound RESULT pseudo-success, missing worker `dispatchId`, missing ACK correlation, and sentinel-only model preflight; `fix_runtime_review_092` owns repairs.
- [x] B4 prep correction: tests 7/7 plus self-check and fixture pass. This remains preparation evidence only, not the real benchmark; before/restored-state-byte semantics still need independent review.
- [x] Workflow/docs author checks: generator 38/38 and intelligence policy 4/4; independent integration audit/recovery is owned by `verify_integration_092`.
- [ ] All AC-01..AC-09 remain pending until parent-model actual acceptance. The
  working-tree 0.9.2 candidate bump is present; exact GitHub push, fresh-install
  real-task benchmark, and holdout rerun have not occurred.

## Current checkpoint

- Scope is retained in full: decomposition/economic routing; all 17 wf commands;
  context pack/recovery; wf-learn memory; Codex/Claude/OpenCode/A2A/PTY;
  browser-free backend plus optional UI; appropriate web and official
  GitHub/Hugging Face reuse; competitor/SOTA-gap/selling-point analysis;
  independent acceptance/baseline; 0.9.2 push without npm publish; and
  post-push fresh-install real tasks, holdout, repair, and rerun.
- The CLAUDE philosophy/routing and event+gate versus memory-retrieval
  rules-policy are supplemental design candidates only. No GitHub branch-rule
  change is authorized.

## Current checkpoint (2026-09-09)

- Independent context verification and the self-contained portability/budget
  lane are green; the latter is 49/49 with `cache-diagnostics-route` at
  35702/36000 bytes. This is a per-invocation role/task pack budget, not a
  product-wide 8192 limit.
- The latest independent chat-effort verifier is 4/4; effort/server/settings
  is 5/5; server integration is 42/42; the driver subset is 34/34; and
  lifecycle plus CLI is 9/9. Server-version is 1/1 with related 43/43 green.
  The bounded Claude quick probe reached exact gpt-5.6-luna with no fallback;
  xhigh remains requested-only and this is not formal benchmark evidence.
- Workflow/docs evidence remains generator 38/38, policy 4/4, and all 17
  command surfaces registered/mirrored; it is not 17 live cross-runtime E2E.
- B3 legal trace/scorer and capability gates are locally green; B4/B6 remain
  prep/fixture evidence only. Automatic economic routing, automatic context
  freshness, measured memory quality, and standards-level A2A remain
  unverified. The working tree now carries the 0.9.2 candidate version and
  generated release artifacts, but exact pushed-SHA provenance, fresh-install
  run, and the real benchmark have not occurred; do not claim benchmark pass.
- Non-blocking open question: the bounded Claude probe is not a formal provider
  benchmark and its CLI-reported total_cost_usd is not a bill. The parent also
  awaits the user's choice on hard-rule event+gate behavior. Existing
  rules-policy notes remain design candidates only, with no authorization to
  change GitHub settings.
- The earlier W6 selective-staging/preflight note is superseded by the final
  candidate review below; it is retained in the log as history, not a current
  running fact.

## Current checkpoint (final candidate review — 2026-09-09)

- Immutable candidate tree `f335c74f3120df1467521558baa596a6df678f18` was independently reviewed. The selector repair is correctly inside `<select>` with `bindableTasks`; existing Skills Market code was not removed.
- Candidate gate **FAIL**: UI build exits 1 because `WorkflowRoute.tsx:143,146,149-150` imports Skills Market exports that are absent from unchanged `nodeRuntimeClient.ts`. Targeted/full candidate checks have five failures: manifest missing ignored `Harness/a2a/workflows.json`; two `cli-smoke` `INDEX.json` assertions; `pack-smoke` missing UI dist after build failure; and `wf-learn` mirror mismatch.
- Static package/server `0.9.2`, manifest B3/B6, protected state-path, and project-path checks passed. Residual docs issue: `Harness/scripts/README.md:67` still uses `research-policy ... --project .`.
- Prior runtime/context/effort/CLI/portability PASS evidence, user dirty state, and unstaged Skills Market removal are preserved. No commit, push, or npm publish occurred; all AC-01..AC-09 remain pending and this candidate is not committable. Automatic routing/context freshness/memory quality/standards A2A and post-push fresh benchmark remain unverified.

## Composition API v0.1 incremental checkpoint (2026-09-10)

- Additive scope only: `COMPOSE-AC-01..COMPOSE-AC-05` are recorded in the
  task PLAN; the original `AC-01..AC-09` remain unchanged and `pending`.
- Contract source of truth is
  `Harness/tasks/task-upgrade-harness-092/COMPOSITION-API-CONTRACT.md`.
  It binds `compositionId` to `workflowId`, keeps typed graph/revisioned
  event-node/bridge/audit state canonical, fixes Timer `event` and Agent
  `control` ports, requires backend FSM/envelope/revision/idempotency, and
  makes composition aggregation read-only. Source/API anchors are listed in
  the PLAN contract section; no second composition store or UI state write is
  authorized.
- Wave ledger: `W2-COMPOSE-RED` done; `W3-COMPOSE-IMPLEMENT` pending parent
  dispatch/contract confirmation; `W4-COMPOSE-VERIFY` pending W3. These waves
  are additive to the existing W6 candidate/release gate and do not authorize
  commit, push, npm publish, or changes to `Harness/a2a/**`.
- Real RED command: `node --test tests/node-composition-api.test.mjs` ->
  **6 tests, 1 pass, 5 fail**. COMPOSE-AC-04 passes. AC-01 fails because
  reverse control returns `201`; AC-02 stale revision and idempotency checks
  fail; AC-03 lacks envelope `transitionId`; AC-05 returns `404` for the
  composition snapshot route. These are retained as current pre-implementation
  evidence, not acceptance.
- Current gate remains `implementation-fix/independent-verify`; all original
  AC and all composition AC remain pending until implementation, independent
  verification, review/reflector, exact-SHA release, fresh-install, and the
  post-push benchmark gates are actually satisfied.

## Composition matrix RED checkpoint (2026-09-10, historical)

- Command: `node --test tests/node-composition-matrix.test.mjs`.
  Result: **4 scenarios, 3 pass, 1 fail**. Passing scenarios are Matrix-B
  (Skill Group + MCP Connector capability context without provider execution),
  Matrix-C (Agent -> Timer control edge and policy-gated interval mutation),
  and Matrix-D (edge/node deletion leaves no dangling graph edges).
- Matrix-A (Markdown + File -> Agent -> Display resource context) was the
  RED at that checkpoint. It stopped while creating the Display node: the API returns
  `400 BAD_REQUEST`, `Invalid settings kind`, because the settings whitelist
  omits `display` (reported by
  `src/wf-ui-server/workflow-node-settings-store.mjs:129`). The test therefore
  does not yet reach its resource-context assertions.
- The then-pending repair was to extend the settings-kind allowlist to accept
  `display` without removing existing kinds, then rerun Matrix-A and the full matrix;
  independently verify Display appears in `connectedResourceRefs` with its
  Markdown/File/Agent graph connections. This is a source-code fix item for
  `W3-COMPOSE-IMPLEMENT`; no acceptance threshold or PLAN AC status changes.
- This matrix result is supplemental composition evidence only. The existing
  `implementation-fix/independent-verify` gate, original `AC-01..AC-09`, and
  `COMPOSE-AC-01..05` remain pending.

## Composition hardening checkpoint (2026-09-10)

- Third-round backend hardening moved the composition implementation checks
  from RED to GREEN: canonical composition ID, durable wakeup
  `ack/consumed`, and Timer/GitHub-trigger separation are covered by the
  repaired backend behavior.
- Combined composition coverage is **15/15**, and the related
  server/runtime/timer regression coverage is **104/104**. This is
  implementation/regression evidence, not final acceptance evidence.
- The prior composition API and matrix RED results remain in the log as
  historical evidence. `COMPOSE-AC-01..05` and the original `AC-01..AC-09`
  are unchanged and remain `pending` until independent verification,
  review/reflector, release, fresh-install, and benchmark gates complete.

## Frontend/backend boundary RED checkpoint (2026-09-10, historical)

- Fourth-round static source-contract test:
  `node --test tests/frontend-backend-boundary.test.mjs` -> **4 tests, 0
  pass, 4 fail**.
- RED-01: `nodeRuntimeClient` lacks typed
  `WorkflowCompositionSnapshot`/`fetchWorkflowComposition`.
- RED-02: no readonly composition cache keyed by
  `compositionId + graphVersion`.
- RED-03: `WorkflowRoute` does not consume composition/context through the
  typed backend client.
- RED-04: `WorkflowRoute` still derives capsule mode/protocol-step business
  semantics locally.
- Next implementation slices: add the GET-only typed readonly client and
  revision-pair cache; wire route rendering to backend composition/context;
  remove local FSM/timer/edge aggregation while retaining layout geometry;
  rerun the four tests, UI build, and independent composition regression.
  These remain pending work and do not alter any AC status.

## Backend capsules projection GREEN checkpoint (2026-09-10)

- The backend capsules projection is GREEN for the composition slice: capsule
  business fields now come from the canonical backend composition/context
  projection, with the UI limited to read-only presentation/cache duties.
- This supersedes the local-aggregation gap in the historical frontend RED
  checkpoint. It is implementation evidence only; uncovered original ACs and
  unverified composition acceptance items remain pending.

## Frontend/backend boundary GREEN checkpoint (2026-09-10)

- `tests/frontend-backend-boundary.test.mjs` is now **4/4**, and the associated
  frontend typecheck/build checks pass.
- The verified slices are the typed readonly composition snapshot client, the
  `compositionId + graphVersion` cache key, and a pure `WorkflowRoute`
  backend projection that retains only layout geometry locally.
- The prior 4-fail result remains historical RED evidence. This GREEN result
  does not change the status of any uncovered original AC or unverified
  composition AC.

## Composition HTTP benchmark checkpoint (2026-09-10)

- `node-composition-http`: **2/2 scenarios**, **16/20 HTTP calls** observed.
- Scenario 1: Timer -> Agent -> Goal (approximately **2.1 s**).
- Scenario 2: Markdown/File/Skill/MCP -> Agent -> Display (approximately
  **0.65 s**).
- This is supplemental HTTP benchmark evidence for these two scenarios only;
  it does not replace independent review, release/fresh-install gates, or
  acceptance of uncovered original ACs.

## Latest independent verification checkpoint (2026-09-10)

- Composition API + matrix + hardening + consistency + HTTP benchmark:
  **23/23**.
- Server/runtime/action regression subset: **124/124**.
- M2 UI E2E: **9/9**.
- M3 UI E2E full run: **29/30**. The single drag result is being treated as a
  flaky case pending a clean full rerun; the targeted key M3 regression set is
  **5/5**, and the settings contract has been corrected.
- UI typecheck and production build: **pass**.
- Remaining gates: full M3 rerun/flake classification; B1-B6 fresh-install
  benchmark from an exact pushed SHA; real Luna execution and independent
  scoring; same-model baseline; untouched holdout; and the P0/P1 backend API
  completeness/state-machine audit. All original and composition ACs remain
  `pending`; no commit/push/npm publish occurred.

## Log

| Date | Phase | Note |
|---|---|---|
| 2026-09-09 | Intake | Created durable WF task; existing five outer tasks and user state preserved. |
| 2026-09-09 | Plan | Added AC-01..AC-09, W0 table, dependency gates, baseline/release safety, fresh-install benchmark and holdout contract. |
| 2026-09-09 | Plan | External report: 17 wf commands covered; dynamic queue/layered memory direction sound, but runtime closure/cost evidence missing; no SOTA claim. |
| 2026-09-09 | Plan | Runtime report: reuse typed create/start/restart/sendMessage/readMessages and A2A/peer-capsule envelopes; add dispatch idempotency, recovery, ack-result; keep backend auto-prepare/UI attach separate. |
| 2026-09-09 | Acceptance | Corrected parent-model/Luna worker ownership, set `defaultAgentRuntime` to `codex`, froze contracts and benchmark; W1 done, W2 running. |
| 2026-09-09 | Acceptance/Test | Independent test-writer added backend ensure CLI RED (3 tests) and lifecycle contract RED (4 tests; 3 existing tests pass); W3 context/runtime workers are running. |
| 2026-09-09 | Implementation/Docs | Workflow/docs lane integrated conditional context-pack/research routing, Useful/Strict fan-out contract, executable wf-learn flow, README/source reuse notes, and mirrored command/spec/template surfaces; ACs remain pending. |
| 2026-09-09 | Verification/Review | Generator 38/38, intelligence policy 4/4, context-budget 4/4, validator pass; install version gate remains 0.9.1 pending release. Context/memory author report 29/29 GREEN; independent verify/runtime review and B4 correction remain open. |
| 2026-09-09 | Current checkpoint | Gate moved from stale `w2-red` to `implementation-fix/independent-verify`; context original 7/7 independent pass plus 3 new REDs, author 71/71 GREEN; runtime 10/14 pass with 4 RED; B4 prep 7/7/self-check/fixture green only; all ACs and release/benchmark remain pending. |
| 2026-09-09 | Current checkpoint supersession | Latest independent chat effort 4/4, effort/server/settings 5/5, server integration 42/42, driver subset 34/34, lifecycle+CLI 9/9, and portability/context-budget 49/49 (35702/36000) are green locally. Prior REDs remain historical; candidate version/provenance, fresh install, real benchmark, baseline, holdout, automatic routing/context freshness, measured memory quality, and standards A2A remain pending. |
| 2026-09-09 | Current W6 checkpoint | Server-version 1/1 and related 43/43 are green; user-confirmed Claude quick probe reached exact gpt-5.6-luna with no fallback. W6 selective staging/preflight remains running; next is independent actual-candidate tree review. xhigh is requested-only, cost field is CLI telemetry, and all AC remain pending. |
| 2026-09-09 | Final candidate review | Immutable tree f335c74f3120df1467521558baa596a6df678f18 independently reviewed: selector/version/manifest/protected-path static checks pass, but UI build exits 1 from missing Skills Market exports and targeted/full candidate checks report five failures. Candidate is not committable; no commit/push/npm; all AC remain pending. |
| 2026-09-10 | Composition hardening | Third-round backend repair is GREEN on canonical composition ID, durable ack/consumed, and Timer/GitHub separation: 15/15 composition tests and 104/104 server/runtime/timer regressions. Implementation evidence only; composition and original AC statuses remain pending. |
| 2026-09-10 | Frontend boundary RED | Fourth-round static boundary test `tests/frontend-backend-boundary.test.mjs` is 0/4 pass, 4/4 fail; typed snapshot client, revision-pair cache, route backend reads, and removal of local composition business aggregation remain implementation slices. |
| 2026-09-10 | Composition projection | Backend capsules projection is GREEN; canonical composition/context now supplies capsule business fields and the UI remains a read-only projection/cache consumer. Uncovered ACs remain pending. |
| 2026-09-10 | Frontend boundary GREEN | `tests/frontend-backend-boundary.test.mjs` is 4/4; typed snapshot/cache, pure route projection, and frontend typecheck/build checks pass. Prior 4-fail result is retained as historical RED evidence. |
| 2026-09-10 | Composition HTTP benchmark | `node-composition-http` is 2/2: Timer -> Agent -> Goal (~2.1 s) and Markdown/File/Skill/MCP -> Agent -> Display (~0.65 s), with 16/20 HTTP calls. Supplemental evidence only; uncovered ACs remain pending. |
| 2026-09-10 | Latest independent verification | Composition/API/matrix/hardening/consistency/HTTP benchmark 23/23; server/runtime/action 124/124; M2 UI 9/9; M3 full 29/30 with one flaky drag case, targeted key M3 5/5 and settings contract corrected; UI typecheck/build pass. Full M3 rerun, B1-B6 fresh-install/real Luna/baseline/holdout benchmark, and P0/P1 API audit remain open; all ACs pending. |
