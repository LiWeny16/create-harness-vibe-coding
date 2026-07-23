# Agent Lessons And Patterns

Purpose: record reusable lessons from review, debugging, validation, and handoff loops.

Write here when:
- A review/debug loop reveals a reusable prevention pattern.
- A validation failure exposes a missing regression check.
- A handoff, dispatch, or context-loading pattern should be repeated or avoided.

Entry format (compact, default no date):

```markdown
- When <scenario>: <rule>. Avoid <over-application>. Signals: <signals>.
```

Only use date/timestamp headings when:
- Entry supersedes prior conflicting guidance
- Time-sensitive context (version, deprecation)
- Conflict resolution needed

Keep entries lightweight and actionable. Avoid secrets, speculative lessons, task logs, and process summaries.
- Entry supersedes prior conflicting guidance: add date stamp.

## Lessons

- When a WF-MAX/WF Worker channel fails (timeout/missing/unavailable): do NOT fall back to a CEO-thread MCP tool call (`mcp__codex.codex_implement`, `mcp__claude.claude_implement`) and log it as "preserving the CEO no-source-edit invariant" — that is **fake compliance** (in-process tool call: no independent context, no enforced writeSet). Worker = independent agent context only (native subagent or peer-CLI process). Avoid counting any CEO-thread tool call as Worker execution. Signals: task record says "delegated to mcp__*.implement", "preserve no-source-edit invariant" + mcp tool used, high failure count + CEO wrote source. Enforced by `Harness/specs/workflows/WF-MAX.md` "Worker Channel Degradation & Independence" + validator (task-* capsules forbidding `mcp__*.implement` unless ANTI-PATTERN). Historical instance: `tasks/task-framework-metrics-and-entry-contract/PLAN.md:791`.

- When dispatching a WF-MAX Worker: prefer native subagent (Agent tool) first when it has already returned successfully in the session; otherwise use a bounded peer CLI via `wf-agents-docs` and return an evidence packet on stdout. Avoid assuming "all channels down" from stale failure logs, creating ad hoc probe scripts, or writing peer output to `%TEMP%`. Signals: framework-metrics-style failure, "channel unavailable", 300s timeout, failure count rising, CEO tempted to write source directly.

- When editing any file under `templates/common/`: the root `Harness/.harness-version` checksums are auto-synced by `npm run build:version` (write mode), and drift is caught by `scripts/check-root-harness-version.mjs` (pre-push check); `acceptedConflicts` `accept-local` files + their cross-runtime mirrors are exempt. Avoid hand-patching root checksums (error-prone — was the drift root cause through cycles 2-4). Signals: pre-push "root harness-version drift" FAIL, root checksum lagging templates, `Harness/.harness-version` stale after a templates edit.

- When a test creates a temp dir (`os.tmpdir()` + `fs.mkdtempSync`): clean up via a node:test `after()` hook — module-level `tempRoots=[]`, push each root inside the `tmpdir()` helper, `after(() => for r of tempRoots fs.rmSync(r,{recursive,force}))` — NOT an inline `rmSync` at the tail of each test body (a throwing `assert.*` above it skips cleanup and leaks). Avoid classifying inline-tail cleanup as a "positive control" (`tests/p0-blockers.test.js` was mis-audited as clean but leaked on any failing assert). Backstop: `scripts/check-temp-leak.mjs` wraps a command, snapshots `harness-*` in `os.tmpdir()` before/after, FAILs on net-new dirs; wired into `scripts/pre-push-check.mjs` around `npm test`. Convention: every framework temp dir uses the `harness-` prefix so the guard stays accurate. Signals: `%Temp%/harness-*` accumulating unboundedly (8383 dirs / ~4.8 GB observed → slow boot / Windows Defender scan), `mkdtempSync(os.tmpdir()` with no paired `after()`, pre-push running `npm test` every push. Historical instance: `tasks/task-tempdir-cleanup/` (fixed `tests/{validate-harness,update-collision,generator,cli-smoke,check-harness-version,p0-blockers}.test.js` + new `scripts/check-temp-leak.mjs`).
