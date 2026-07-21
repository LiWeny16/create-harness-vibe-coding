# install-flow-log-analysis - PLAN

## Goal

Reduce the Harness install path from an AI-heavy read/merge process to a script-first flow:

- scripts do deterministic scanning, copying, dry-run planning, checksum and conflict classification
- AI reads only files requiring semantic merge or user-facing product facts
- validation is scripted and recorded once, not repeatedly rediscovered

## Acceptance Criteria

- [ ] Identify token/time waste visible in `temp/log.log`.
- [ ] Map each waste point to a scriptable improvement or an AI-only responsibility.
- [ ] Ground recommendations in current installer source and templates.
- [ ] Preserve conflict-file safety: no overwrite without explicit policy or user consent.

## Scope

Allowed write set:
- `src/index.js`
- `README.md`
- `README-CN.md`
- `templates/common/SETUP.md`
- `Harness/SETUP.md`
- `tests/cli-smoke.test.js`
- `tests/generator.test.js`
- `Harness/tasks/install-flow-log-analysis/`

Forbidden:
- Product source changes unless explicitly selected after analysis.
- Destructive git operations.

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `temp/log.log`
- `src/index.js`
- `src/generator.js`
- `tests/cli-smoke.test.js`
- `tests/generator.test.js`
- `README.md`
- `README-CN.md`
- `templates/common/SETUP.md`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| none | solo bounded analysis | log + installer docs/source | none | Active |

## Subagent Synthesis

Agents used: none
Findings accepted: dry-run JSON already exists but lacked root scan and AI-specific next actions; docs still encouraged manual scan and template reading; validators were being run more often than needed; README verify wording caused agents to run `npm test` in generated non-Node repos.
Findings rejected: broad package-source reading after a successful dry-run is not needed for install safety.
Conflicts: none
Decisions: add bounded `scan` and `agent` sections to `--json` output; document that `plan.create` is script-owned and only `agent.aiMergeRequired` needs semantic AI/user merge.
Residual risk: future optional templates may need more precise `templateHint` mapping if optional file conflicts become common.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| Log readable as UTF-8 | PASS | `Get-Content -Encoding UTF8 temp/log.log` |
| `node --check src/index.js` | PASS | Syntax check |
| `npm run test:smoke` | PASS | CLI smoke tests, 23 pass / 1 skipped |
| `npm test` | PASS | 65 pass / 1 skipped |
| `node Harness/scripts/validate-harness.mjs --strict` | PASS | Harness validation passed (strict) |
