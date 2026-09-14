# Effort compatibility implementation evidence (2026-09-09)

Status: source/adapter/server GREEN; bounded effort, identity, and settings
handoff checks pass without provider inference.

## Decision and configuration boundary

The approved native-first strategy is implemented for Codex and OpenCode. The
Harness-owned operator declaration shape is:

```json
{
  "schema": "harness-settings@1",
  "runtimeCapabilities": {
    "claude": {
      "models": {
        "gateway/claude-luna": {
          "supportedEfforts": ["low", "high", "xhigh"]
        }
      }
    }
  }
}
```

The model key is exact and request payloads cannot add or replace it. The
result is labelled `sourceKind: harness-operator-runtime-capabilities` and
`verificationLevel: operator-configured`; it does not claim provider
measurement, account entitlement, or task success. Existing vendor
`availableModels` remains model-only evidence and does not prove effort.

The top-level settings POST now preserves an existing declaration when the
ordinary patch omits it, and rejects add/replace/delete/null/invalid attempts
before any write with `RUNTIME_CAPABILITIES_OPERATOR_ONLY` or
`RUNTIME_CAPABILITIES_INVALID`. Vendor runtime-config writes remain separate.
No claim of provider measurement, account entitlement, or HTTP caller
authorization is made by this declaration.

## RED before source changes

Before adding the parser exports, the dedicated test could not instantiate the
new contract (`model-capability.mjs` had no `parseOpenCodeVerboseCatalog`
export). The pre-change launch capture also recorded the actual omission:

```text
codex    ["--model", "gpt-6-astra"]
claude  ["--model", "claude-opus-4-7"]
opencode ["--model", "openai/gpt-5.2"]
```

These were the existing `resolveRuntimeLaunchArgs` results with an explicit
`effort: "xhigh"`; no effort/variant argument was present.

## GREEN checks

Dedicated test:

```text
node --test src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs
6 tests, 6 pass, 0 fail
```

The test covers all three native argument forms, PTY adapter propagation,
OpenCode per-model variant isolation, no metadata => `UNVERIFIED`, exact
operator declaration provenance, and legacy no-effort arguments.

Related matrix:

```text
node --test src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs \
  tests/review-effort-server-092.test.js \
  src/wf-ui-server/__tests__/pty-adapter.test.mjs \
  src/wf-ui-server/__tests__/settings.test.mjs \
  src/wf-ui-server/__tests__/runtime-detector.test.mjs \
  src/wf-ui-server/__tests__/runtime-review.test.mjs
60 tests, 60 pass, 0 fail
```

Syntax checks for `model-capability.mjs`, `runtime-detector.mjs`,
`pty-adapter.mjs`, and `settings.mjs` also pass.

## Native discovery and no-inference checks

No prompt, thread, turn, or paid inference was sent.

```text
Codex probe: runtime=codex, model=gpt-5.6-luna, effort=xhigh
status=supported, sourceKind=codex-app-server-model-list,
verificationLevel=authoritative,
supportedEfforts=[low, medium, high, xhigh, max]

OpenCode probe: runtime=opencode, model=gpt-5.6-luna, effort=xhigh
status=unsupported, sourceKind=opencode-models,
verificationLevel=authoritative, complete=true,
reason.code=MODEL_PROVIDER_REQUIRED

OpenCode probe: runtime=opencode, model=opencode/gpt-5.6-luna, effort=xhigh
status=supported, sourceKind=opencode-models,
verificationLevel=authoritative,
supportedEfforts=[none, low, medium, high, xhigh, max], effortVariant=xhigh,
catalogModelId=opencode/gpt-5.6-luna

OpenCode probe: runtime=opencode, model=opencode-go/gpt-5.6-luna, effort=xhigh
status=supported, sourceKind=opencode-models,
verificationLevel=authoritative,
effortVariant=xhigh, catalogModelId=opencode-go/gpt-5.6-luna
```

The installed verbose catalog contains both `opencode/gpt-5.6-luna` and
`opencode-go/gpt-5.6-luna` (same bare `id`, different provider). Strict
dispatch therefore rejects a bare model with a provider/model instruction;
it never selects the first catalog entry. Qualified requests retain their
requested and effective IDs and launch the same qualified ID via `--model`.

OpenCode was queried with the installed native command
`opencode models --pure --log-level ERROR --verbose`; the parser reads the
selected model's own `variants` metadata and never copies a neighboring
model's variant. Name-only/nonverbose rows remain model-only evidence.

Installed CLI checks (no credentials printed):

```text
claude --version  -> 2.1.215 (Claude Code)
codex --version   -> codex-cli 0.153.4
opencode --version -> 1.18.4
```

Installed help confirms `codex -c/--config <key=value>` and `-m/--model`,
Claude `--effort <level>` and `--model`, and OpenCode `--variant` and
`--model provider/model`.

Captured launch argv from the pure adapter (Windows `.cmd` wrapper included):

```json
[
  {"runtime":"codex","requestedArgs":["--model","gpt-5.6-luna","-c","model_reasoning_effort=xhigh"],"windowsArgs":["/d","/c","call","codex.cmd","--model","gpt-5.6-luna","-c","model_reasoning_effort=xhigh"]},
  {"runtime":"claude","requestedArgs":["--model","gateway/claude-luna","--effort","xhigh"],"windowsArgs":["/d","/c","call","claude.cmd","--model","gateway/claude-luna","--effort","xhigh"]},
  {"runtime":"opencode","requestedArgs":["--model","opencode/gpt-5.6-luna","--variant","xhigh"],"windowsArgs":["/d","/c","call","opencode.cmd","--model","opencode/gpt-5.6-luna","--variant","xhigh"]}
]
```

Official references consulted:

- https://developers.openai.com/api/docs/models
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/cli-usage
- https://opencode.ai/v2/docs/models

## Server handoff checks

`tests/review-effort-server-092.test.js` exercises the real
`POST /api/sessions` -> capability preflight -> server -> PTY recorder path.
It verifies Codex, Claude, and OpenCode effort handoff on initial and one retry,
HTTP settings preservation/rejection, HTTP self-authorization rejection, and
OpenCode bare-provider rejection. The worker recorder observes the exact
qualified OpenCode model and trusted model-level variant; no inference is run.

## Settings mutation inventory and guard

- Runtime HTTP mutation: `POST /api/settings` is the only server route that
  writes the top-level `Harness/settings.json`; it deep-merges ordinary fields
  but rejects a changed `runtimeCapabilities` field before the write.
- Runtime vendor mutation: `POST /api/runtimes/:runtime/config` writes only
  provider-owned Claude/Codex/OpenCode files through `runtime-config.mjs`; it
  does not target `Harness/settings.json` and must not be repurposed for the
  Harness declaration.
- Workflow-node settings: workflow/component node settings are separate files
  below `Harness/a2a/**` and are not the project settings declaration.
- Scaffold/update: `generator.js` creates or merges the initial
  `Harness/settings.json`; this is an operator/offline setup path, not a live
  HTTP settings mutation.

The guard is at the top-level settings POST boundary: ordinary patches omit
`runtimeCapabilities` and preserve the existing value; add, replace, null,
delete-shaped, nested, and invalid values fail before any settings write. The
guard does not affect vendor config writes or initial scaffold generation.

## Structured chat native-wire handoff

After the independent chat verifier supplied its RED, the structured path was
connected without disabling `transport: "chat"`:

- `server.mjs` now passes the canonical effort and trusted OpenCode
  `effortVariant` into `spawnChatRuntimeSession`, `resolveRuntimeLaunchArgs`,
  and `createChatDriver` on both initial and retry creation.
- Claude stream-json appends the exact `--effort <value>` only when an effort
  was requested; legacy driver construction does not add the flag.
- Codex app-server uses the documented `turn/start.params.effort` field on
  every new turn and starts with `--config model=<exact-model>` plus the
  native `--config model_reasoning_effort=<effort>`. Generic PTY `--model`
  pairs are not passed to the app-server subcommand.
- OpenCode sends the exact model and trusted model-level variant as top-level
  prompt request fields. Generic `--model`/`--variant` pairs are removed from
  `opencode serve` argv because the installed CLI rejects those serve options;
  the values remain in the prompt request.

Independent verifier body result (no provider inference):

```text
tests/review-chat-effort-092.test.js
4 test bodies pass: server chat initial/retry, Codex app-server, Claude
stream-json, OpenCode server. Windows afterEach fs.rmSync then reports EPERM
for the verifier-owned temporary project; the independent test was not changed.
```

Repository driver matrices after the handoff:

```text
codex-appserver.test.mjs       11 pass
claude-stream-json.test.mjs   10 pass
opencode-server.test.mjs      13 pass
runtime-detector + pty + effort compatibility 23 pass
```

No thread/turn/provider inference was run. Local native evidence for the wire
field names remains the installed Codex app-server v2 schema
(`TurnStartParams.effort`), Claude CLI help (`--effort`), and OpenCode server
`/doc` (`variant` on `message` and `prompt_async`).

Real installed OpenCode no-inference startup capture (temporary cwd, owned
server disposed after `start()`; no prompt was sent):

```json
{
  "baseUrl": "http://127.0.0.1:<ephemeral-port>",
  "sessionCreated": true,
  "spawn": {
    "command": "opencode",
    "argv": ["serve", "--port", "<ephemeral-port>"]
  }
}
```

The input selector argv was `--model openai/gpt-5.6-luna --variant xhigh`; the
driver removed those run-only selectors from `serve` (which rejects them) and
kept them for the prompt request. The first cleanup attempt raced the Windows
owned PID and returned EPERM; after PID exit, the verified temporary cwd was
removed. No credential or provider response was read.
