# PROGRESS: Add WF Help Command

## Status

Phase: Verified

## Heartbeat

- 2026-07-02: Started `/wf-help` direct command task. Scope is command file plus router/validator/test sync.
- 2026-07-02: Added dogfood/template direct command, router docs, validator checks, and tests. Validation passed.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| `npm run build:version` | PASS | `templates/common/.harness-version` rebuilt with 76 checksums and 91 source entries. |
| `node Harness/scripts/validate-harness.mjs` | PASS | Harness validation passed. |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Strict placeholder scope passed. |
| `npm test` | PASS | 65 passed, 1 skipped. |
| `node scripts/build-version.mjs --check` | PASS | Version file up to date. |
| Direct command check | PASS | `.claude/commands/wf-help.md` and template mirror exist; `.claude/skills/wf-help` and `.agents/skills/wf-help` are absent. |
