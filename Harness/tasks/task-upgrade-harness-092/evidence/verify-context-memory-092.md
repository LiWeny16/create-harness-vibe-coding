# Independent context/memory boundary verification

Date: 2026-09-09
Role: independent verifier (`gpt-5.6-luna`, `xhigh`)

## Commands and results

| Probe | Result | Evidence |
|---|---|---|
| `node --test tests/harness-intelligence-boundaries.test.js` | PASS | 7/7 tests |
| `node --test tests/task-context.test.js tests/memory-context.test.js tests/research-policy.test.js tests/task-state.test.js tests/harness-intelligence-policy.test.js tests/harness-intelligence-install.test.js` | RED only on release version gate | 66/67 pass; install expects package `0.9.2`, current package is `0.9.1` |
| `node Harness/tasks/task-upgrade-harness-092/evidence/reviewer-context-memory-repro.mjs` | mixed | Symlink/junction input escape, task traversal, negative budget, role/workItem loss, false verification, global-local write, and research fields are fixed; see findings below |
| `node --test tests/verify-context-memory-092.test.js` | RED | 3/3 independent regression tests fail for RED-01..RED-03 below |

## Independent boundary probes

- A project-root junction alias is accepted and reads the same project task.
- A missing task, a task directory without `STATE.json`, and a missing research task are rejected.
- Feedback creates a missing in-project `evidence` ancestor, but rejects an `evidence` junction whose real target is outside the project; no outside file was written.
- A global root nested under the project, a project nested under the global root, and a same-project junction alias are rejected as non-isolated.
- Zero and negative task/memory budgets fail explicitly. A non-ASCII pack reports UTF-8 `usedBytes` within its limit.
- Unscoped `constraints` remain in packs while role/work-item-scoped facts are filtered; matching role/work-item entries remain available.

## RED findings

### RED-01: canonical task pack is not compatible with the existing context shape

Command:

```text
node Harness/scripts/task-context.mjs pack task-upgrade-harness-092 --project . --role verifier --budget-bytes 10000 --json
```

Result: non-zero with `context.evidence[0] requires path or url`.
The canonical task's existing `STATE.json` stores evidence as `{"id":"E-14","path/url":"CONTRACTS.md",...}` and `{"id":"E-15","path/url":"BENCHMARK.md",...}`. The frozen contract documents `path/url` and the task was created with that shape, while normalization only accepts separate `path` or `url` keys. This blocks a read-only pack of the real task and must be handled by an explicit compatibility rule or migration decision; do not mutate the canonical task as a workaround.

### RED-02: first context write can leave `intent.original` unlocked

The existing repro clears `STATE.context`, applies a first update containing only `intent.current`, then applies a second update containing `intent.original`. The resulting state has `original=LATE_ORIGINAL` and `changes=[]`. If immutable original means the first context write establishes the original intent even when only `current` is supplied, this violates the contract. At minimum, the behavior needs an explicit compatibility decision and regression test.

### RED-03: updating an existing scoped entry drops its applicability guard

An existing fact with `roles=["verifier"]` and `workItems=["W-ONLY"]` is updated by ID with only its text/source/status. `mergeById` replaces the complete entry and removes both lists; a `developer`/`W-OTHER` pack then includes the fact. This can leak role/work-item-specific context after an otherwise ordinary partial update. The regression is covered by the third test in `tests/verify-context-memory-092.test.js`.

## Limitation / interpretation note

For memory query with `--top-k 0 --budget-bytes 1`, the returned skipped summary is bounded (`skipped` is compact and `truncated: true`), but the serialized JSON response is larger than the declared content budget (`usedBytes=1`, wire output observed at 362 bytes). The implementation reports `contentBytes`, `skippedBytes`, and `truncated`; this is acceptable only if the budget is explicitly defined as charged memory content rather than total wire response. If the contract requires total response bytes, this remains RED.

No production, template, canonical task, version, git, real memory, or A2A state files were changed by this verification.
