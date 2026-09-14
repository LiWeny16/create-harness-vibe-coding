# Dispatch CLI verification evidence

AC scope: AC-05 / AC-06 / AC-07. Probe date: 2026-09-09.

## Commands and results

| Probe | Result | Evidence |
|---|---|---|
| `node Harness/scripts/wf-ui-control.mjs help create-agent --json` | PASS as a help probe; the entry has no `dispatch-id`, `task`, `effort`, `transport`, `context-pack-path`, `request-id`, or `reply-to` flags | stdout inspected from the shipped CLI |
| `node Harness/scripts/wf-ui-control.mjs help --json` | PASS as a help probe; dispatch reporting commands and `agent.dispatchProgress`/`agent.dispatchResult` are listed, but no `agent.create` typed action is listed | stdout inspected from the shipped CLI and `Harness/a2a/action-registry.json` |
| `node --test tests/runtime-dispatch-cli.test.js` | RED: 1 pass, 1 fail | The worker report CLI test passes; the normal `create-agent` dispatch test fails at `tests/runtime-dispatch-cli.test.js:240` because the CLI returns a legacy session without `ok` or dispatch fields |
| `node --test --test-name-pattern="worker report CLI" tests/runtime-dispatch-cli.test.js` | PASS: 1/1 | A real `wf-ui-control.mjs dispatch-progress` subprocess and a real `dispatch-result` subprocess consume the injected worker identity and leave the registry session `succeeded` |
| `node --test tests/wf-backend-ensure.test.js` | PASS: 3/3 | `ensure-backend` cold-start, concurrent reuse, and project isolation all pass without opening a browser; it does not supply the missing dispatch-create CLI surface |

The RED test uses `makeHarnessTempRoot`, a test-owned PTY adapter fixture, and a
constructor-injected authoritative model probe. It never calls a live provider
and is not a release benchmark.

## Reproduction / HIGH finding

The test invokes the shipped CLI as an Agent subprocess with the normal
dispatch envelope:

```text
create-agent --dispatch-id dispatch-runtime-cli-092 --task task-runtime-cli-092
  --runtime codex --model gpt-5.6-luna --effort xhigh --transport pty
  --context-pack-path Harness/context-pack.md
  --request-id request-runtime-cli-092 --reply-to reply-runtime-cli-092
```

The process exits 0, but the response is the legacy session shape. Observed
fields include `taskId: null`, `dispatchId: null`, `dispatchStatus: null`,
`requested: null`, `effective: null`, `effort: ""`, and
`contextPackPath: ""`. The fixture spawn options likewise receive no
`dispatchId`, `taskId`, `requestId`, `replyTo`, or context-pack sentinel.

This is HIGH for AC-05/07: an ordinary Agent cannot create the opt-in dispatch
through the shipped CLI, so it cannot obtain the canonical dispatch/session
binding needed for authenticated progress/result reports. Unknown flags are
accepted by the permissive parser and silently dropped by `createAgent`, which
makes the failure easy to mistake for a successful agent creation.

## Supporting source facts

- `Harness/scripts/wf-ui-control.mjs:81-103` documents `create-agent` without
  dispatch creation flags.
- `Harness/scripts/wf-ui-control.mjs:1305-1336` builds the legacy body and
  posts it to `/api/sessions`; it does not copy the dispatch envelope fields.
- `src/wf-ui-server/server.mjs:2020-2037` enters the dispatch path only when
  the POST body already contains `dispatchId`.
- `src/wf-ui-server/dispatch-contract.mjs:54-82` requires
  `dispatchId`, `taskId`, `runtime`, `model`, `effort`, and `transport`, and
  normalizes context refs/project root.
- `src/wf-ui-server/server.mjs:1606-1635` special-cases typed `agent.start`
  and `agent.restart`; these call graph start/restart, not
  `createDispatchedRuntimeSession`.
- `Harness/a2a/action-registry.json:1886-2015` exposes `agent.start` with a
  `create-agent` CLI wrapper; there is no `agent.create` typed action.

## Minimal missing normal-call parameters

The normal CLI/typed create surface needs explicit mappings for:

`dispatchId`, `taskId`, `runtime`, `model`, `effort`, `transport`,
`contextPackPath` (and/or context refs), `requestId`, and `replyTo`.

After creation, the runtime must return the canonical `sessionId` and inject
the service-issued worker capability into the worker process. The existing
report commands already use that identity correctly when supplied.

## Verdict

`ensure-backend`: PASS for cold-start/reuse/isolation.

Dispatch reporting CLI: PASS when a dispatch was created through the raw API.

Normal `create-agent` dispatch creation and typed `agent.create`: FAIL/HIGH;
the first acceptance test remains intentionally RED pending an owner-side CLI
and typed-surface repair.
