# task-release-readiness-cleanup-0922 - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Mode: direct / safe-cleanup + release-readiness
- Owner: pi agent
- Next: establish cleanup allowlist and mirror policy decision, then run release gates
- Blocker: legacy zingspark mirror policy unresolved

## Guardrails

- Preserve `3080.md/png`, `Harness/a2a/**`, user skills and all unconfirmed paths.
- No reset, checkout, clean, push, publish, or source edits.
- Delete only exact artifacts proven generated and unreferenced.
- Release verdict must distinguish PASS, FAIL, INCOMPLETE, and baseline exception.

## Phase checklist

- [ ] W0 capture version, branch, dirty baseline and preserve set
- [ ] W1 decide legacy mirror sync/retire/explicit-exception path
- [ ] W2 produce and verify safe cleanup allowlist
- [ ] W3 apply only approved safe cleanup and record reversibility
- [ ] W4 run all release gates and package dry-run
- [ ] W5 write `RELEASE-READINESS.md` and final verdict
