# Independent integration verification — 0.9.2 candidate

Scope: read-only verifier pass. No source, docs, canonical task/version/git,
realmemory, or A2A state files were changed.

## A — task context

| Check | Result | Evidence |
| --- | --- | --- |
| `tests/verify-context-memory-092.test.js` | PASS (3/3) | path/url evidence compatibility; first-current original lock; partial scoped metadata |
| Core context/memory/research tests | PASS (22/22) | `tests/task-context.test.js`, `tests/memory-context.test.js`, `tests/research-policy.test.js` |
| Boundary tests | PASS (7/7) | `tests/harness-intelligence-boundaries.test.js` |
| Strict original replacement probe | PASS | first `current` became immutable `original`; later replacement was rejected as a recorded change; unrelated fields preserved |
| Canonical real pack | PASS | exit 0, 2 evidence refs, 2635/10000 bytes; `Harness/tasks/task-upgrade-harness-092/STATE.json` SHA256 unchanged: `6E2B6DDE38FBFB471CF4E791ACA132CB3EEB2C19F642CFD29ABC84E6055BBE6A` before/after |

## B — workflow/docs/integration

| Check | Result | Evidence |
| --- | --- | --- |
| command registry/routing | PASS | 17 registry entries; all Claude/OpenCode commands and Claude/Codex skills present; help table has 17 rows |
| mirror parity | PASS | root/template Claude docs and skills identical; `.claude`↔`.agents` skills identical; OpenCode command bodies identical after runtime frontmatter |
| Useful/Strict + pack/research/wf-learn contract | PASS | policy + wf-learn contract tests 7/7 |
| generator install surfaces | PASS | `tests/generator.test.js` 38/38; independent temp install 17/17 surfaces and real installed show/pack/query/decide all exit 0 |
| context budgets | PASS | four route profiles pass (`context-budget.mjs --json`) |
| baseline validator | PASS | `validate-harness.mjs` exit 0; warnings: missing unrelated lifecycle STATE and 6 outer task capsules |
| package content | PASS with pending version | npm dry-run has intelligence scripts, no task/fixture/test leakage; package id/version is `0.9.1` |
| full install test | PENDING release gate | 1/2 pass; AC-08 fails only because package version is `0.9.1`, expected `0.9.2` |
| version manifest check | PENDING release gate | `node scripts/build-version.mjs --check` reports stale manifest (`file WOULD change`) |
| strict validator | PENDING unrelated repository state | fails missing unrelated lifecycle STATE and task-cap warning |
| anti-drift | FAIL | 20/21; temp-root gate lists `tests/verify-context-memory-092.test.js`, `tests/harness-intelligence-boundaries.test.js`, `tests/harness-intelligence-bench.test.js`, `tests/wf-backend-ensure.test.js`, and `src/wf-ui-server/__tests__/runtime-review.test.mjs` as using `os.tmpdir()` instead of `makeHarnessTempRoot()` |

Research routing runtime spot-check: no-trigger chore returns `search:false,
addDependency:false`; capability/benchmark triggers return `search:true` and
`addDependency:false`. No external web lookup was needed for this bounded audit.

## Bounded follow-up

- Moved this evidence file from the repository root to this task evidence directory,
  preserving its original bytes; no root evidence file remains.
- Reused `makeHarnessTempRoot()` and cleanup hooks in the five tests previously
  reported by anti-drift. `node --test tests/anti-drift.test.js` now passes 21/21.
- Corrected `dispatch-lifecycle.test.mjs` to read task-bound session events and
  wait for/assert a real `session.exited` event before checking terminal replay.
  The lifecycle test now passes 7/7, including the no-append negative assertion.
- Follow-up changed-test pass: verify-context 3/3, boundaries 7/7, intelligence
  bench 7/7, backend ensure 3/3, dispatch lifecycle 7/7.
- `node scripts/check-temp-leak.mjs -- node --test ...` over those five suites
  passes 27/27 with no new system/project temp directories.
- `runtime-review.test.mjs` remains 11/14: one unknown-model case returns 201
  instead of expected 422, and two worker report cases return 401
  `DISPATCH_WORKER_UNAUTHORIZED`. These are reported to the runtime fix owner;
  auth assertions were not weakened and no production files were changed here.

## Runtime/auth bounded follow-up

- The two previously failing authenticated good paths now use only the actual
  test-owned PTY spawn injection (`recorder.calls[0].options.workerCapability`)
  in the `X-Harness-Worker-Capability` header, with body `sessionId` and
  `taskId`; request correlation remains canonical and terminal replay is also
  authenticated. Both paths pass.
- Added negative coverage: missing capability, wrong session identity, wrong
  capability, stale session attempt, and an old capability presented to the
  retry session are rejected. The retry remains attempt 1 and no rejected
  report writes a terminal capsule event. No credential value is written to
  this evidence file or any public response/capsule.
- Focused runtime/auth suite: 16/16 pass when the known unknown-model case is
  excluded. Full `runtime-review.test.mjs`: 16/17 pass; the sole failure is the
  retained unknown-model-capability case returning HTTP 201 instead of expected
  422 (pending owner decision; test was not weakened).
- Backend alias isolation: `tests/runtime-review-backend.test.js` 1/1 pass;
  its temp-leak guard also passes. The runtime focused temp-leak guard passes
  (6/6). A later repository-wide anti-drift run is 20/21 because the unrelated
  `tests/harness-intelligence-bench-review.test.js` still violates the temp-root
  helper rule; no change was made outside this bounded runtime test/evidence
  write set.
