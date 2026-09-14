# Independent runtime/pre-release readiness verification (092)

Role: independent verifier. Scope is runtime/model capability gating, dispatch
lifecycle, CLI dispatch wiring, peer/structured backend paths, and PNG-only
oracle behavior. No release, publish, push, inference, credential output, task
state update, version/schema change, or user-memory/A2A-state mutation was
performed.

## Initial blocking finding and bounded fixture correction

The unmodified legacy `src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs`
started the PTY fixture with no trusted model catalog. Under the new default
gate its five legal positive cases correctly returned `422 UNAVAILABLE`
(`codex-app-server-model-list` / `MODEL_CAPABILITY_EMPTY_RESULT`) before spawn.
This was a test-fixture wiring gap, not a production failure.

The fixture now injects a complete test-owned `modelCapabilityProbe` through the
`startServer` constructor (including the restart path), accepting only exact
`codex / gpt-5.6-luna / low|medium|high|xhigh`. No HTTP payload catalog claim is
used; negative cases remain unchanged.

## Final matrix

Command:

```text
node --test src/wf-ui-server/__tests__/runtime-review.test.mjs src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs src/wf-ui-server/__tests__/runtime-detector.test.mjs src/wf-ui-server/__tests__/runtime-config.test.mjs src/wf-ui-server/__tests__/peer-capsule.test.mjs src/wf-ui-server/__tests__/workflow-agent-messages-structured.test.mjs tests/runtime-review-backend.test.js tests/wf-backend-ensure.test.js tests/runtime-dispatch-cli.test.js tests/verify-runtime-release-png-only.test.js tests/verify-runtime-release-cli-project.test.js
```

Result: **74 passed, 0 failed** (exit 0).

| Area | Evidence | Result |
| --- | --- | --- |
| runtime/model/auth gate | `runtime-review.test.mjs` | 27 passed, including unverified/missing/failed probes, HTTP catalog forgery, exact model/effort, worker identity/capability and retry auth |
| legacy dispatch lifecycle | `dispatch-lifecycle.test.mjs` | 7 passed after constructor-only trusted fixture DI |
| runtime config/detector | `runtime-config.test.mjs`, `runtime-detector.test.mjs` | 14 passed |
| peer capsule | `peer-capsule.test.mjs` | 12 passed |
| structured messaging | `workflow-agent-messages-structured.test.mjs` | 6 passed |
| backend boundary | `runtime-review-backend.test.js`, `wf-backend-ensure.test.js` | 4 passed |
| normal create-agent CLI + worker reports | `runtime-dispatch-cli.test.js` | 2 passed |
| independent CLI field/path mapping | `verify-runtime-release-cli-project.test.js` | 2 passed; every dispatch flag reached session/worker, and a different caller cwd remained anchored to `--project` target for server root, default worker cwd, and relative context pack |
| independent PNG-only oracle | `verify-runtime-release-png-only.test.js` | 2 passed |

Runtime driver matrix:

```text
node --test src/wf-ui-server/__tests__/codex-appserver.test.mjs src/wf-ui-server/__tests__/claude-stream-json.test.mjs src/wf-ui-server/__tests__/opencode-server.test.mjs src/wf-ui-server/__tests__/pty-adapter.test.mjs src/wf-ui-server/__tests__/security.test.mjs
```

Result: **51 passed, 0 failed** (exit 0).

Additional scorer checks:

```text
node --test tests/harness-intelligence-bench-review.test.js   # 4 passed
node scripts/harness-intelligence-bench.mjs --self-check       # {"ok":true,"selfCheck":true}
```

## Real default-path read-only probes

Installed versions: Codex CLI `0.153.4`, OpenCode `1.18.4`, Claude Code
`2.1.215`.

OpenCode `opencode models --help` explicitly exposes `--pure` (“run without
external plugins”). A read-only `opencode models --pure --log-level ERROR`
exited 0 and returned 154 model lines.

The actual `probeModelCapability` default path was run against the exact user
requested model `gpt-5.6-luna` (not `gpt6astra` and with no fallback):

```json
{
  "codex": {
    "status": "supported",
    "sourceKind": "codex-app-server-model-list",
    "verificationLevel": "authoritative",
    "complete": true,
    "model": "gpt-5.6-luna",
    "supportedEfforts": ["low", "medium", "high", "xhigh", "max"]
  },
  "opencode": {
    "status": "supported",
    "sourceKind": "opencode-models",
    "verificationLevel": "authoritative",
    "complete": true,
    "model": "gpt-5.6-luna"
  },
  "claude": {
    "status": "unverified",
    "sourceKind": "none",
    "verificationLevel": "unverified",
    "complete": false,
    "model": "gpt-5.6-luna",
    "reasonCode": "MODEL_CAPABILITY_UNVERIFIED"
  }
}
```

The Codex probe used only app-server `initialize` followed by paginated
`model/list`; no thread/turn/prompt/inference request was sent. The OpenCode
probe used only `models --pure`. Claude correctly remains `UNVERIFIED` without
operator `availableModels` source. An explicit unknown Codex model
`gpt-9-no-silent-fallback-092` returned `unsupported / authoritative / complete`
with `MODEL_NOT_IN_AUTHORITATIVE_CATALOG`; no model substitution occurred.

## PNG-only oracle regressions

`tests/verify-runtime-release-png-only.test.js` uses `makeHarnessTempRoot` for
all fixtures and confirms:

- pseudo `.jpg`, `.jpeg`, and `.webp` marker streams are `fail` with exact code
  `IMAGE_FORMAT_UNSUPPORTED`, never pass;
- a genuine 1x1 PNG remains `pass` after CRC/zlib decode;
- a signature-only malformed PNG remains `fail / IMAGE_NOT_DECODABLE`.

## Verdict

**PASS for the bounded pre-release readiness matrix.** Residual caveat:
OpenCode's catalog result has no effort metadata, so dispatch requests that
require an effort such as `xhigh` remain correctly `UNVERIFIED` unless a
trusted effort catalog is available. Release remains intentionally unperformed
pending the controller's authorization.

## Mirror check (reported separately from local readiness)

`npm run check:mirrors` exited 1. Local generated/template bytes for the CLI
fix are equal (`Harness/scripts/wf-ui-control.mjs` and
`templates/common/Harness/scripts/wf-ui-control.mjs` SHA-256:
`dfc89f1121032c52fd6b2c935b5f8c3fec125152a427bb13e0619644ac29aaed`). The
online check independently reports the existing remote state: canonical and
legacy `main` branches advertise generator versions `0.8.20`/`0.8.19` versus
local package `0.9.1`, and canonical/legacy `v0.9.1` endpoints return HTTP 404.
No publish or push was attempted; this is an external release-sync condition,
not a runtime readiness failure.
