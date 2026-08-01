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

- When a WF-MAX/WF Worker channel fails (timeout/missing/unavailable): do NOT fall back to a CEO-thread MCP tool call (`mcp__codex.codex_implement`, `mcp__claude.claude_implement`) and log it as "preserving the CEO no-source-edit invariant" - that is **fake compliance** (in-process tool call: no independent context, no enforced writeSet). Worker = independent agent context only (native subagent or peer-CLI process). Avoid counting any CEO-thread tool call as Worker execution. Signals: task record says "delegated to mcp__*.implement", "preserve no-source-edit invariant" + mcp tool used, high failure count + CEO wrote source. Enforced by `Harness/specs/workflows/WF-MAX.md` "Worker Channel Degradation & Independence" + validator (task-* capsules forbidding `mcp__*.implement` unless ANTI-PATTERN). Historical instance: `tasks/task-framework-metrics-and-entry-contract/PLAN.md:791`.

- When dispatching a WF-MAX Worker: prefer native subagent (Agent tool) first when it has already returned successfully in the session; otherwise use a bounded peer CLI via `wf-agents-docs` and return an evidence packet on stdout. Avoid assuming "all channels down" from stale failure logs, creating ad hoc probe scripts, or writing peer output to `%TEMP%`. Signals: framework-metrics-style failure, "channel unavailable", 300s timeout, failure count rising, CEO tempted to write source directly.

- When editing any file under `templates/common/`: the root `Harness/.harness-version` checksums are auto-synced by `npm run build:version` (write mode), and drift is caught by `scripts/check-root-harness-version.mjs` (pre-push check); `acceptedConflicts` `accept-local` files + their cross-runtime mirrors are exempt. Avoid hand-patching root checksums (error-prone - was the drift root cause through cycles 2-4). Signals: pre-push "root harness-version drift" FAIL, root checksum lagging templates, `Harness/.harness-version` stale after a templates edit.

- When framework/tests create temp dirs: put them under project-local `Harness/.temp` via `tests/support/temp-root.js` or a local subdir such as `Harness/.temp/wf-ui-launch`, and always remove them in `after()`/`afterEach()`/`finally` with `fs.rmSync(..., { recursive: true, force: true })`. Never introduce new `fs.mkdtempSync(path.join(os.tmpdir(), ...))` sandbox roots. Backstop: `scripts/check-temp-leak.mjs` snapshots known framework prefixes in system temp and recursively snapshots `Harness/.temp`; any net-new leftover in either location fails. Signals: `%Temp%/harness-*` accumulating unboundedly, `mkdtempSync(os.tmpdir()` in tests, or `Harness/.temp` not empty after guarded tests. Historical instances: `tasks/task-tempdir-cleanup/`; `src/wf-ui-server/__tests__/session-cleanup.test.mjs` leaked two inline cleanup dirs until moved to named finally-cleaned roots.
