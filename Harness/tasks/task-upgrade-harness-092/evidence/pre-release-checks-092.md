# Pre-release checks (0.9.2 candidate)

Probe date: 2026-09-09. Read-only release-preparation pass. No source,
test, task state, version, staging, commit, push, or publish operation was
performed by this pass.

## Repository baseline

| Check | Result | Evidence |
|---|---|---|
| Branch | PASS | `agent/wf-ui-state-checkpoint-20260804` |
| Upstream | PASS | `origin/agent/wf-ui-state-checkpoint-20260804` |
| Ahead/behind | PASS | `git rev-list --left-right --count HEAD...@{upstream}` = `2 0` |
| Working tree | ATTENTION | 197 status entries (153 tracked/other, 44 untracked); existing multi-agent/user worktree preserved |

Representative stage categories (recommend review and selective staging only):

- Candidate framework source: `src/**` (25 status entries).
- Candidate templates: `templates/common/**` (63 status entries).
- Candidate docs/release files: `README*`, `CHANGELOG.md`, `CLAUDE.md`,
  `package.json`, and Harness docs/version files (9 status entries).
- Candidate tests: `tests/**` (22 status entries), including new release/dispatch
  fixtures.
- Candidate benchmark asset: `benchmarks/harness-intelligence-092/` (1 entry).
- Must remain unsubmitted unless explicitly selected by the release owner:
  `Harness/tasks/**`, `Harness/a2a/workflow-map.json`, `Harness/a2a/nodes/**`,
  `3080.md`, `3080-xianyu-cover.png`, and unrelated user/task state. Do not
  resolve warnings by archiving or deleting these files in this pass.

## Gate matrix

| Command | Result | Notes |
|---|---|---|
| `npm test` | FAIL / INCOMPLETE | Windows command runner stopped at its 30s call limit before final summary; first failure was AC-08 package test. Isolated reproduction: `0.9.1 !== 0.9.2` at `tests/harness-intelligence-install.test.js:121`. |
| `node --test tests/anti-drift.test.js` | PASS 21/21 | No drift assertions failed. |
| `node --test tests/validate-harness.test.js` | PASS 55/55 | Full validator test file passed. |
| `node Harness/scripts/validate-harness.mjs` | PASS with warnings | Existing missing `task-make-wf-lifecycle-0908/STATE.json` and 6 outer task capsules (cap 5). |
| `node templates/common/Harness/scripts/validate-harness.mjs` | PASS with warnings | Same pre-existing task warnings. |
| `node Harness/scripts/validate-harness.mjs --strict` | FAIL / known | Strictly rejects the same missing STATE and outer-task cap; do not mutate task state here. |
| `node templates/common/Harness/scripts/validate-harness.mjs --strict` | FAIL / known | Same strict task-state warnings. |
| `node Harness/scripts/context-budget.mjs --json` | PASS | All four route profiles passed. |
| `node scripts/build-version.mjs --check` | FAIL / known release gate | Candidate files would change the generated version/checksum manifest; 0.9.2 bump/build phase is pending. |
| `npm run check:mirrors` | FAIL / known release gate | Remote main reports generator 0.8.20/0.8.19 vs local 0.9.1; v0.9.1 URLs return 404. |
| `node --check scripts/check-update-mirrors.mjs` | PASS | Syntax only. |
| `node scripts/check-script-mirrors.mjs` | PASS | All 5 local script mirror pairs identical. |
| `npm run pack:smoke` | PASS 3/3 | Dry-run package smoke. |
| `node scripts/check-temp-leak.mjs -- npm run pack:smoke` | PASS | No temp leak reported. |
| `node --test tests/pack-smoke.test.js` | PASS 3/3 | Core/template package presence and debug-artifact exclusion. |
| `npm pack --dry-run --json` source/leak probe | PASS | Current package `create-harness-vibe-coding@0.9.1`, 7,885,652 bytes, 713 files; intelligence scripts present; task/fixture/3080 paths absent. |

## Non-browser runtime checks

| Command | Result |
|---|---|
| `node --test tests/runtime-dispatch-cli.test.js` | PASS 2/2 |
| `node scripts/check-temp-leak.mjs -- node --test tests/runtime-dispatch-cli.test.js` | PASS |
| `node --test tests/wf-backend-ensure.test.js` | PASS 3/3 |
| `node --test src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs` | PASS 7/7 |
| `node --test tests/verify-runtime-release-cli-project.test.js` | PASS 2/2 |
| `node --test tests/verify-runtime-release-png-only.test.js` | PASS 2/2 |
| `node --test src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs` | PASS 12/12 |

UI dist builds, browser evidence, and full GUI E2E are intentionally not part
of this pass; they remain assigned to the runtime/UI verifier.

## Release readiness

The implementation/runtime and package smoke gates above are green. Release is
not ready to publish: the package is still 0.9.1, version/checksum generation
is stale, remote mirror checks are stale/404, strict task warnings remain, and
the worktree mixes candidate framework changes with protected user/task/A2A
state. The release owner must first approve selective staging, run the 0.9.2
version/build phase, verify source SHA and clean-install provenance, and retain
the explicit no-`npm publish` boundary.
