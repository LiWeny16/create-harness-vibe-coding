# PROGRESS: Remove WF Hook Docs

## Status

Phase: Verified

## Heartbeat

- 2026-07-02: User confirmed broad hook deletion was intentional. Created cleanup task capsule and started hook-boundary doc/validator sync.
- 2026-07-02: Removed stale hook docs, hook artifacts, old batch hook tests, and runtime mode file; validation passed.
- 2026-07-02: User clarified the single allowed exception: `/wf-auto` may use an optional bounded tick hook for long-chain running. Updated WF-AUTO, validator, and memory rules.
- 2026-07-02: Removed empty default hook config files/properties and verified only `/wf-auto` hook exception remains.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| `npm run build:version` | PASS | Wrote `templates/common/.harness-version`; 75 checksums, 90 source entries. |
| `node Harness/scripts/validate-harness.mjs` | PASS | Harness validation passed. |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Strict placeholder scope passed. |
| `npm test` | PASS | 65 passed, 1 skipped. |
| `node scripts/build-version.mjs --check` | PASS | Version file already up to date. |
| Hook artifact absence check | PASS | `.codex/hooks.json`, template `.codex/hooks.json`, `HOOK_PROTOCOL.md`, `wf-mode-hook.mjs`, `wf-statusline.*`, `tests/e2e-wf-hooks.test.mjs`, `tests/batch`, and `Harness/.runtime/current-mode.json` absent. |
| Stale claim search | PASS | Remaining hook-string hits are wf-auto exception text, validator forbid-list, memory/current task guard text, or non-runtime React/test wording. |
