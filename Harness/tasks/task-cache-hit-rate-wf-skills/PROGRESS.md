# task-cache-hit-rate-wf-skills - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Verified
- Next: report result to user; future real hit-rate claims require provider usage telemetry.
- Blocker: none

## Tasks

- [x] Load WF, memory, router, subagent, dispatch, and context-loading instructions.
- [x] Confirm previous active task is unrelated and create a new task capsule.
- [x] Extract cache/token principles from external web + GitHub sources.
- [x] Map exact WF command and skill-framework write set.
- [x] Implement cache-hit-rate guidance.
- [x] Add explicit validation levels so structural checks cannot be presented as real cache hits.
- [x] Validate mirrors, generator behavior, and harness structural checks.
- [x] Run review pass and closeout.

## Changes

- Added cache-first context ordering to runtime and template `Harness/context-loading.md`: stable prefix, scoped references, dynamic suffix, deferred skill/tool loading, bounded summaries, and cache-boundary triggers.
- Added cache validation levels:
  - L0 structural regression checks prove only that the framework preserves cache-friendly shape.
  - L1 prefix simulation proves byte-identical stable prefixes across dynamic suffix changes.
  - L2 provider telemetry proves real cache hits through usage fields.
- Added a hard truth boundary: do not claim real cache hits or hit-rate improvement from structure checks alone.
- Routed WF docs, WF kernel, dispatch, subagent guidance, `.claude` skills, `.agents` skills, and OpenCode `wf*` wrappers through the cache-first contract.
- Updated validator and generator tests to fail if cache discipline, telemetry boundary, or OpenCode routing is removed.
- Ran `scripts/archive-tasks.mjs --apply --json` to move old `task-wf-ux-compatibility` into `Harness/tasks/_archive/2026/` and restore the outer task capsule cap.
- Added `tests/l1-prefix-simulation.test.js`: 16 SHA-256 hash-based tests proving stable prefix byte identity across dynamic-only suffix changes, negative controls for prefix mutations, and anti-pollution detection for dynamic fields leaking into stable prefix.

## Verification

- PASS: `node Harness/scripts/validate-harness.mjs`
- PASS: `npm run check:mirrors`
- PASS: `node scripts/build-version.mjs --check`
- PASS: `node --test tests/validate-harness.test.js tests/generator.test.js` (62 tests)
- PASS: `npm test` (164 pass, 1 skip)
- PASS: `node --test tests/l1-prefix-simulation.test.js` (16 tests — positive match, negative controls, anti-pollution detection)

## Research Evidence

- Tavily CLI limitation: `tvly` was not installed; bash install path failed because `bash` is not available; referenced `tavily-cli` skill file is missing locally. Built-in web search will be used for this task.
- OpenAI Prompt Caching guide: prompt caching reuses exact prompt prefixes; automatic caching starts at 1024 tokens; stable content should be placed at the beginning and variable content at the end; cache telemetry includes `cached_tokens` and `cache_write_tokens`; `prompt_cache_key` can improve routing.
- Anthropic Prompt Caching guide: cache prefixes are checked in tools -> system -> messages order; tool definition changes invalidate lower caches; useful telemetry fields include `cache_creation_input_tokens` and `cache_read_input_tokens`; best practices are stable reusable prefixes, deterministic breakpoints, and hit-rate analysis.
- GitHub Docs on optimizing AI usage: shorter persistent instructions, scoped subagents, explicit phases, and avoiding model/tool/context switches reduce waste and preserve cache reuse.
- GitHub Blog on Copilot token efficiency: prompt caching and deferred tool loading are core platform techniques for repeated prefixes and avoiding unused tool schema bloat.
- GitHub `agents-best-practices`: stable prefix/dynamic suffix, deterministic tool/skill ordering, and moving timestamps/trace IDs out of the stable prefix improve cacheability.
- GitHub `Agent-Skills-for-Context-Engineering`: context optimization combines caching, partitioning, compression, and retrieval scoping when token cost or cache hit rate matters.
- GitHub `openclaw/openclaw#26750`: dynamic runtime data should live outside stable prompts; fixed tool order and cache-safe compaction preserve reuse.
- arXiv `Don't Break the Cache`: dynamic tool calls/results can reduce cache usefulness; stable system prompts and provider-aware thresholds matter in long-horizon agent tasks.

## Notes

- Previous global active task was `task-homepage-act1-flat-layout`; it is unrelated to this cache/token objective and remains in the task index.
- External CLI reviewer was degraded: `claude -p` was callable but produced no usable review output in this environment. A bounded same-runtime reviewer pass found no high/critical issues and recorded the main residual risk: real hit-rate proof requires L2 provider telemetry not exposed by local Harness checks.

## L2 Follow-up

- Added `Harness/scripts/l2-cache-telemetry.mjs` plus template mirror: a Claude Code JSON telemetry collector for provider L2 evidence. It runs bounded read-only groups (`provider-control`, `harness-thin`, `wf-light`), resumes each session for warm turns, records usage/cost/duration/session IDs outside the repo, and blocks README claims until the claim gate is satisfied.
- Added `tests/l2-cache-telemetry.test.js`: dry-run plan audit, provider input-only ratio formula, and measured-vs-improvement claim-gate separation.
- Tightened L2 probe prompts after a real run showed ambiguous "L2 cache" wording could be misread as CPU cache; warm prompts now name Claude Code prompt-cache telemetry fields explicitly.
- PASS: `node --test tests/l2-cache-telemetry.test.js` (3 tests)
- PASS: real Claude Code L2 sample via `node Harness/scripts/l2-cache-telemetry.mjs --groups provider-control,harness-thin,wf-light --turns 3 --turn-budget-usd 0.32 --total-budget-usd 0.90 --timeout-ms 240000`
  - Report: `C:\Users\onion\.claude\cache-telemetry\harness-l2-20260723-125847.json`
  - Result: 9/9 successful turns, total reported cost `$0.276482`
  - Warm median read ratio: provider-control `93.2%`, harness-thin `98.2%`, wf-light `/wf` `98.9%`
  - README measured/improvement claim gate: false; each Harness group has only 2 warm telemetry turns, below the 10-turn minimum.
- PASS: claim-gate Claude Code L2 sample via `node Harness/scripts/l2-cache-telemetry.mjs --groups provider-control,harness-thin,wf-light --turns 11 --turn-budget-usd 0.32 --total-budget-usd 1.20 --timeout-ms 240000`
  - Report: `C:\Users\onion\.claude\cache-telemetry\harness-l2-claim-20260723-130331.json`
  - Result: 33/33 successful turns, total reported cost `$0.529830`
  - provider-control: 10 warm turns, warm median read ratio `93.3%`, warm range `91.1%-95.4%`, warm median latency `2123.5 ms`
  - harness-thin: 10 warm turns, warm median read ratio `98.7%`, warm range `98.1%-99.2%`, warm median latency `1786.5 ms`, uplift `+5.4 percentage points`
  - wf-light `/wf`: 10 warm turns, warm median read ratio `99.1%`, warm range `98.7%-99.7%`, warm median latency `2900 ms`, uplift `+5.8 percentage points`
  - README measured/improvement claim gate: true; recorded in `README.md` and `README-CN.md` with explicit bounded-sample caveat.
- PASS: release-readiness checks after README claim:
  - `node --test tests/l2-cache-telemetry.test.js tests/generator.test.js tests/anti-drift.test.js`
  - `node Harness/scripts/validate-harness.mjs`
  - `node Harness/scripts/validate-harness.mjs --strict`
  - `node Harness/scripts/context-budget.mjs`
  - `node scripts/build-version.mjs --check`
  - `npm run check:mirrors`
  - `npm test` (198 pass, 1 skip)
  - `npm pack --dry-run` (includes `templates/common/Harness/scripts/l2-cache-telemetry.mjs`)
- Release status: npm latest is `0.8.13`; git already has `v0.8.14`, so the L2/README release candidate was bumped to `0.8.15`. `npm whoami` returns 401 in this terminal, so npm publication requires npm login before `npm publish`.
- Post-bump release gate on `0.8.15`:
  - PASS: `node Harness/scripts/validate-harness.mjs --strict`
  - PASS: `node scripts/build-version.mjs --check`
  - PASS: `node Harness/scripts/context-budget.mjs --json`
  - PASS: `npm test` (198 pass, 1 skip)
  - PASS: `npm run test:e2e` (168 pass, 0 fail)
  - PASS: `npm run test:smoke` (29 pass, 1 skip)
  - PASS: `npm run pack:smoke` (2 pass)
  - PASS: `npm pack --dry-run --json` (`create-harness-vibe-coding-0.8.15.tgz`, 151 files, includes L2 telemetry and context-budget scripts)
  - PASS: `npm publish --dry-run` (`create-harness-vibe-coding@0.8.15`, 151 files, package size 1.7 MB, tag latest, dry-run only)
  - PASS: `node Harness/scripts/l2-cache-telemetry.mjs --from-file "$env:USERPROFILE\.claude\cache-telemetry\harness-l2-claim-20260723-130331.json" --json` recalculates the same claim-gate true summary.
  - BLOCKED: `npm whoami` returns `E401 Unauthorized`.
  - EXPECTED FAIL until release push/tag: `npm run check:mirrors` reports remote main still has generator `0.8.14` and both `v0.8.15` tags are 404.
