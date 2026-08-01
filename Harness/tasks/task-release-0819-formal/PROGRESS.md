# task-release-0819-formal - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Blocked
- Next: receive npm OTP, run `npm dist-tag add create-harness-vibe-coding@0.8.19 latest --otp <code>`, then rerun final release gates.
- Blocker: npm EOTP for dist-tag update.

## Verification

- [ ] `npm view create-harness-vibe-coding@latest version dist-tags --json`
- [x] `git ls-remote` for canonical and legacy `main` plus `v0.8.19`
- [x] `gh release view v0.8.19` for canonical and legacy
- [x] `npm run check:mirrors`
- [x] `node scripts/pre-push-check.mjs`
- [x] public install/update smoke checks for explicit `0.8.19` and explicit-source `0.8.18 -> 0.8.19`

## Log

| Date | Phase | Note |
|------|-------|------|
| 2026-07-31 | Intake | Prior audit found npm latest still 0.8.18, no v0.8.19 tags/releases, and legacy mirror still 0.8.18. |
| 2026-07-31 | Verify | Canonical tag created by GitHub API; legacy main fast-forwarded and legacy tag pushed; both GitHub Releases created. |
| 2026-07-31 | Verify | `npm dist-tag add create-harness-vibe-coding@0.8.19 latest` failed with EOTP; user OTP or npm web auth is required to finish npm latest. |
| 2026-07-31 | Verify | `npm run check:mirrors` passed after canonical/legacy main and tag sync; 0.8.19 install validator, manifest-audit, scan-clean passed; explicit-source 0.8.18 update applied 38 files and validated clean. |
| 2026-07-31 | Verify | Rechecked npm registry: `latest` is still `0.8.18` and `experimental` is `0.8.19`; waiting for npm OTP to finish AC-001. |
| 2026-07-31 | Blocked | Rechecked again: npm `latest` remains `0.8.18`; GitHub refs and mirror gate remain PASS. Blocking condition is unchanged and requires npm OTP/user auth. |
