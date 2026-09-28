# task-implement-wf-search-extensions - PLAN

## Goal

Implement global lazy extension runtime for wf-search and align wf-ui/extensions location under Harness/extensions

## Scope

Write set:
- `Harness/scripts/extensions.mjs` and its template mirror
- `Harness/extensions/registry.json` and its template mirror
- wf-search command/skill documentation and focused tests
- installer/version/ownership wiring required for the global extension root
- task-local tests and verification evidence

Forbidden:
- Do not bundle yt-dlp, RSSHub, browser engines, Whisper models, or platform
  crawler dependencies into the default Harness install.
- Do not expose the remote Whisper HTTP service publicly.
- Do not move or rewrite the existing wf-ui server in this change; represent
  its current global-runtime/built-in status explicitly and preserve behavior.

## Tier

WF-Standard: multi-file behavior change with one independent review lens.

## Acceptance Criteria

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Extension payloads resolve exclusively under the global runtime's `Harness/extensions/<id>/<version>` root; project-local `Harness/extensions` contains only lock/config metadata. | `tests/extensions.test.js` shared-global/two-project install | PASS |
| AC-002 | A lazy extension ensure operation is idempotent, verifies manifest/schema/hash/path, rejects traversal and unsafe destinations, and leaves no partial install on failure. | `tests/extensions.test.js` RED/GREEN + cache/hash/traversal cases | PASS |
| AC-003 | `wf-search` has a bootstrap path that keeps the base command usable while declaring/ensuring its deep-search extension on demand; platform/ASR dependencies remain optional. | command/skill contract tests; optional dependency manifest | PASS |
| AC-004 | `wf-ui` is documented and registered as a built-in global-runtime capability, not falsely treated as a downloaded project extension; future downloaded extensions use the same global root. | registry/docs mirror tests and built-in rejection test | PASS |
| AC-005 | Root/template mirrors, ownership manifests, strict validation, version check, focused tests, full tests, and independent review pass. | root/template, `npm test`, `pack:smoke`, build-version check, manual audit; external reviewer unavailable | PASS WITH REVIEW LIMITATION |

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Reuse the existing optional catalog/installer concepts, but store downloaded extension payloads in the global runtime under `Harness/extensions/`; project `Harness/extensions` is metadata only. | Keeps default installs small and avoids duplicate per-project payloads. | 2026-09-18 |
| 2 | Keep wf-ui bundled in the global runtime for this change and mark it as built-in; do not risk moving its large server/UI surface before an independent migration plan. | Current wf-ui is lazy-loaded from the global package, not a downloaded extension. | 2026-09-18 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | | | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
