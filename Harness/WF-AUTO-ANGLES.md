# WF-AUTO Adaptive Coverage Protocol

`wf-auto` does not need a permanent number of angles. It needs enough
independent evidence to discover a valuable next change without repeatedly
scanning irrelevant surfaces.

## Design goals

- Select probes from evidence, not from a fixed checklist.
- Keep safety and user intent visible in every cycle.
- Spend more context on risky or recently changed areas.
- Record skipped probes and the reason they were skipped.
- Stop only after the relevant coverage obligations are satisfied and two
  different confirmation passes produce no actionable finding.

## Probe catalog

The catalog is extensible. These are probe families, not mandatory agents:

| Probe | Primary question | Trigger signals |
|---|---|---|
| Goal / value | Is this change still moving the project toward the user's outcome? | user goal, roadmap, product behavior, repeated scope drift |
| Context / memory quality | Does the agent receive the right context at the right time without noise or loss? | long tasks, repeated rediscovery, oversized prompts, stale memory |
| Correctness / safety | Can the change be wrong, destructive, or inconsistent? | changed logic, state transitions, file writes, data mutations |
| Security / privacy | Can an attacker or accidental disclosure exploit this path? | auth, permissions, input, secrets, network, personal data |
| Security / privacy | Can an attacker or accidental disclosure exploit this path? | auth, permissions, input, secrets, network, personal data |
| Reliability / recovery | What happens on timeout, interruption, retry, partial failure, or restart? | external calls, queues, persistence, background work, flaky tests |
| Performance / cost | Is time, memory, token, I/O, or bundle cost becoming material? | hot paths, large data, repeated scans, slow tests, cost evidence |
| Architecture / changeability | Will this make the next change harder or violate boundaries? | new dependency, cross-layer edit, duplicated state, large diff |
| Test / verification | Is the claimed behavior actually checked with the right evidence? | new behavior, changed acceptance criteria, weak or missing tests |
| Evaluation / outcome quality | Can we tell whether the agent or product actually improved? | AI behavior, subjective output, benchmark drift, vague success claims |
| Maintainability | Will a future maintainer understand and safely change this? | duplication, dead code, naming, stale comments, complex functions |
| UX / DX / observability | Can a user or developer understand, operate, and diagnose it? | CLI/API changes, errors, docs, logs, metrics, browser-visible flow |
| Dependency / ecosystem | Is an external assumption stale, unsafe, or unnecessarily costly? | package changes, deprecations, API version changes, external research |

Add a probe when the project domain requires it. Do not force every project to
run every probe.

## Selection algorithm

At the start of every W0 cycle, the CEO builds a project profile from the
repository, task capsule, recent diff, failures, and user direction. For each
candidate probe, score these signals from 0 to 5:

```text
priority =
  0.30 * risk
  + 0.25 * changeRelevance
  + 0.20 * evidenceGap
  + 0.15 * expectedUserValue
  + 0.10 * novelty
  - 0.10 * scanCost
```

The score is a ranking aid, not a claim of mathematical precision. The CEO
must record the evidence behind the top scores.

Select probes until one of these conditions is met:

1. all high-risk obligations are covered;
2. the next probe's expected value is below the scan-cost threshold;
3. the cycle context budget is spent; or
4. the selected probes have overlapping scope and the next one adds no new
   coverage.

Every cycle includes the two guardrails **Goal / value** and
**Correctness / safety**, unless the CEO records why a project has no relevant
user outcome or executable behavior. Other probes are conditional. A normal
low-risk cycle may use only a few probes; a dependency, security, data, or
production incident cycle should select more.

## Dynamic obligations

The project profile creates obligations instead of a fixed angle count:

| Evidence in the project | Required probe families |
|---|---|
| Auth, permissions, secrets, personal data | Security / privacy + Correctness / safety |
| Database, queue, filesystem, network, background jobs | Reliability / recovery + Correctness / safety |
| Public API, CLI, SDK, schema, or config contract | Goal / value + Test / verification + UX / DX |
| Hot path, large data, slow suite, cost complaint | Performance / cost + Test / verification |
| Cross-layer or dependency-boundary change | Architecture / changeability + Correctness / safety |
| Browser-visible behavior | UX / DX / observability + Test / verification + real browser evidence |
| Documentation-only change | Goal / value + UX / DX / observability; skip code probes unless triggered |

If multiple rows match, merge their obligations and deduplicate overlapping
probes. A skipped obligation must have a reason in the cycle ledger.

## Common probe recipes

These recipes are starting points, not another fixed checklist. Select only the
probes supported by the current evidence:

| Project or change type | Start with | Add when triggered |
|---|---|---|
| Web app / API | Goal / value, Correctness / safety, Test / verification, UX / DX | Security for auth/input; Reliability for external calls; Performance for hot paths |
| CLI / SDK / public package | Goal / value, contract compatibility, UX / DX, Test / verification | Dependency for version changes; Maintainability for API surface growth |
| AI agent / workflow system | Goal / value, Context quality, Correctness / safety, Evaluation / verification | Security for tool access; Cost for token/tool growth; Recovery for long-running state |
| Data pipeline / async jobs | Correctness / safety, Reliability / recovery, Test / verification | Performance for volume; Security for sensitive data; Observability for production diagnosis |
| Documentation / README / growth copy | Goal / value, UX / DX / discoverability, factuality, link integrity | Dependency for install commands; Accessibility for rendered UI or diagrams |

For an AI agent repository, **context quality**, **tool safety**, **evaluation**,
and **recovery** are usually more valuable than a generic maintainability scan.
For a docs-only change, do not spend a cycle pretending to optimize algorithmic
performance.

## Scan strategies

Confirmation passes must change the search strategy, not merely repeat the same
prompt:

- **Breadth** — map affected modules, interfaces, tests, and user paths.
- **Depth** — trace one high-risk path from input to observable outcome.
- **Change-first** — inspect the latest diff, failures, and touched boundaries.
- **Failure-first** — start from flaky tests, incidents, TODOs, and user reports.
- **Contract-first** — compare behavior against PRD, acceptance criteria, API,
  CLI, or documentation promises.

Rotate strategies when a pass is empty. Re-run a probe when its confidence is
below 0.8 or its relevant surface coverage is below 80%.

## Exhaustion gate

The A-GATE is evidence-based:

1. all dynamic high-risk obligations for the current project profile are
   covered;
2. every selected probe returns structured findings, confidence, and surface
   coverage;
3. no selected probe has an actionable finding above the current value gate;
4. two confirmation passes use different strategies and produce no new
   actionable finding; and
5. the CEO records unresolved uncertainty, skipped probes, and why oracle or
   spark search was or was not needed.

The cross-model oracle is triggered by unresolved high-risk uncertainty or a
borderline exhaustion result. Spark search is triggered by a genuine value gap,
not merely because a catalog was empty. This prevents both premature stopping
and pointless full-tree scanning.

## Cycle ledger

Each W0 entry records compact JSON-like evidence:

```text
profile: web-api + public-auth + recent-db-change
goal: reduce failed checkout recovery time
selected: correctness/safety, reliability/recovery, security/privacy, test/verification
skipped: performance/cost (no hot-path signal); dependency/ecosystem (no dependency change)
strategy: change-first
coverage: 0.92
findings: 2
next: reliability finding, priority 4.3/5
```

The ledger makes angle choice explainable, lets the next cycle avoid duplicate
work, and gives `/wf-review` or the user enough evidence to challenge the
selection.

## User controls

Users can steer selection in natural language without learning hidden flags:

```text
/wf-auto 重点优化安全和数据恢复，忽略没有证据支持的性能优化
/wf-auto 只关注 CLI 易用性、文档和错误提示
/wf-auto 先扫描最近改动和失败测试，再决定本轮分析探针
```

The agent must treat these as priorities, not permission to skip safety or
verification for a change that can affect data or production behavior.
