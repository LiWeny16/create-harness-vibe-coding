# task-release-0819-formal - PLAN

## Goal

- Outcome: Formally release 0.8.19 so users receive it through npm latest and existing installs can update through canonical and legacy sources.
- Non-goals: Unrelated source edits, README rewrites, or changes to the two pre-existing open task scopes.

## Scope

Write set:
- Git remote refs/tags/releases for `LiWeny16/create-harness-vibe-coding` and `zingspark/create-harness-vibe-coding`
- npm dist-tags for `create-harness-vibe-coding`
- This task capsule and root `Harness/PROGRESS.md`

Forbidden:
- Rewriting unrelated git history
- Editing production source unless a release verification failure proves a package bug

## Decisions

| # | Decision | Reason | Date |
|---|----------|--------|------|
| 1 | Use WF-Standard release verification | Release work spans multiple external systems and needs one independent review lens | 2026-07-31 |

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | npm has `create-harness-vibe-coding@0.8.19` published and `latest` points to `0.8.19` | `npm view ...` output | pending |
| AC-002 | Canonical and legacy GitHub expose `main`, `v0.8.19`, and release metadata with manifest generator `0.8.19` parity | `git ls-remote`, `gh release view`, `npm run check:mirrors` | passed |
| AC-003 | Install/update verification passes from public package and mirrors | pre-push gate, install smoke, update smoke, validators, scan-clean | partial |

## Subagent Dispatch

| Role | Mode | Read set | Write set | Purpose | Status |
|------|------|----------|-----------|---------|--------|
| reviewer | independent review | release evidence packet only | none | Check for missing release-chain requirements before final closeout | pending |

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Missing npm/GitHub credentials | Probe auth before mutation; report exact blocker if unavailable | open |
| `0.8.19` package content mismatch | Validate tarball, install path, update path, and manifests after dist-tag/tag repair | open |
