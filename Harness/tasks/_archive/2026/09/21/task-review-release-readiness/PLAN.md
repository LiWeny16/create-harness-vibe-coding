# task-review-release-readiness - PLAN

## Goal

审查当前工作区是否达到可发布状态，并归纳新增功能；只读审查，不修改生产代码、不执行发布。

## Scope

Write set:
-

Forbidden:
-

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Do not publish the current worktree | The release gate is not green and package version remains 0.9.5, already published at HEAD | 2026-09-21 |
| 2 | Treat wf-research and lazy extensions as the primary feature set | The new command, extension manager, deep-research catalog, media/video helpers, and tests form the coherent candidate | 2026-09-21 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | Summarize the candidate's new functionality | README.md, wf-research command, extension registry, feature tests | done |
| AC-002 | Verify package/test/release gates without publishing | npm test second run 496 pass/1 skip; prepush and mirror/version gates fail | blocked |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Version and generated checksum metadata are stale | Bump to a new release version, update CHANGELOG, run build-version and root checks | open |
| Legacy zingspark mirror is behind/missing v0.9.5 | Sync main/tag/release artifact before release completion | open |
| Worktree contains broad tracked and untracked changes | Classify intended release files and remove/ignore runtime artifacts before commit | open |
| Full-suite timeout test was flaky on the first run | Re-run passed; investigate timing robustness before relying on the gate | open |
