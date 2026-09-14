# Cross-CLI effort compatibility design (read-only)

Date: 2026-09-09  
Scope: capability/adapter/config inspection only. No source, request, test,
canonical task, version, Git, A2A, credential, or provider-inference changes.

## Key conclusion

The current dispatch gate is stricter than the current adapters: `effort` is
mandatory (`low|medium|high|xhigh`) in
`src/wf-ui-server/dispatch-contract.mjs`, but
`src/wf-ui-server/runtime-detector.mjs` and `pty-adapter.mjs` currently pass
only the model to each CLI. A pure adapter check showed that an `effort=xhigh`
input produces:

| Runtime | Current launch arguments (model + xhigh input) | Native effort flag/selector available |
| --- | --- | --- |
| Codex | `--model <model>` | native catalog reports supported efforts; adapter does not forward one |
| Claude/cc | `--model <model> --session-id <id>` | installed CLI accepts `--effort <level>` |
| OpenCode | `--model <provider/model>` | installed `run` accepts `--variant <id>`; IDs are model-specific |

Therefore the present `supported` result for an OpenCode model is model-only;
it is not evidence that the requested effort is supported. Claude's current
string-only `availableModels` path has the same limitation.

## Bounded observations

Installed commands and versions:

| Command | Version | Relevant help observation |
| --- | --- | --- |
| `claude` | `2.1.215 (Claude Code)` | `--model <model>` and `--effort <level>`; help lists `low, medium, high, xhigh, max` |
| `codex` | `codex-cli 0.153.4` | `app-server` is installed and exposes the native model-list protocol used by the existing probe |
| `opencode` | `1.18.4` | `run --variant` is a provider-specific model variant; `models --pure [--verbose]` is available |

The existing native Codex probe performed only app-server
`initialize`/`model/list` (no thread, turn, prompt, or inference). It returned
authoritative complete entries for:

- `gpt-5.6-luna`: `low, medium, high, xhigh, max`
- `gpt-6-astra`: `low, medium, high, xhigh, max, ultra`

This validates `gpt-5.6-luna/xhigh` and `gpt-6-astra/xhigh` on the local Codex
catalog only. It does not transfer that claim to Claude or another provider.

For OpenCode:

- `opencode models --pure --log-level ERROR` exits 0 and lists
  `opencode/gpt-5.6-luna`, but emits names only. The existing probe therefore
  returns `status=supported`, `sourceKind=opencode-models`,
  `verificationLevel=authoritative`, and no `supportedEfforts`.
- `opencode models --pure --log-level ERROR --verbose` exits 0 and exposes
  metadata without executing a model. The current catalog has
  `opencode/gpt-5.6-luna` and `opencode-go/gpt-5.6-luna`, each with variants
  `none, low, medium, high, xhigh, max`; `opencode/gpt-6-astra` has
  `low, medium, high, xhigh, max`. The variant metadata is the precise effort
  evidence that the current non-verbose probe drops.

For Claude:

- There is no installed native model/effort listing command in the bounded
  CLI help surface. Claude 2.1.215 exposes `--model` and `--effort`, but a flag
  being accepted does not establish account access or model support.
- The local user settings file has `model` and global `effortLevel` keys, but
  no `modelSettings` or `availableModels` key. The project settings file has
  no model allowlist. No credential values were read or emitted.
- The official Claude model configuration documents model-specific effort
  levels and explicitly says unsupported model IDs are not covered by that
  table. It also documents per-model `modelSettings` and the `--effort` flag.
  See [Claude model configuration](https://code.claude.com/docs/en/model-config)
  and [Claude CLI reference](https://code.claude.com/docs/en/cli-usage).

The local OpenCode user config has provider/model objects and a few
provider-specific `variants` objects, but no `gpt-5.6-luna` custom entry; the
project `opencode.json` has no model/variant declaration. Only key names and
counts were inspected; API key/header values were not read into evidence.
OpenCode's official docs say variants are model-specific, should come from the
current catalog, and unknown variants fail resolution rather than silently
using the base model. See [OpenCode models and variants](https://opencode.ai/v2/docs/models).

## Minimal safe options

1. **Native metadata/variants first (recommended for OpenCode).** Change the
   OpenCode capability reader to consume the structured `--verbose` catalog,
   normalize each variant's declared `effort` or `reasoningEffort`, and retain
   the exact runtime variant ID for launch. Accept `xhigh` only when the
   selected model's metadata declares it; otherwise return
   `UNVERIFIED/MODEL_EFFORT_METADATA_UNAVAILABLE` or
   `UNSUPPORTED/MODEL_EFFORT_NOT_SUPPORTED` and do not spawn. Do not map an
   arbitrary friendly variant such as `deep` unless its metadata explicitly
   declares the requested effort.

2. **Trusted operator extension (required for Claude custom/gateway IDs).**
   Extend the server-side operator capability source—not the HTTP envelope—to
   publish an exact model entry and its `supportedEfforts`, for example:

   ```json
   { "id": "claude-opus-4-7", "supportedEfforts": ["low", "medium", "high", "xhigh", "max"] }
   ```

   This must be read from a trusted operator config/registry and recorded with
   source kind and verification level. A string `availableModels` entry alone
   remains model-only and cannot authorize an effort. The same shape can be
   used for a custom OpenCode provider when native metadata is unavailable.

3. **Optional effort only by a separate contract decision.** If the controller
   wants model-only dispatches, it may approve an empty effort as
   “unspecified”; the worker must then omit `--effort`/`--variant`, and the
   response must retain `effort` as unspecified/unverified. A non-empty
   requested effort with missing metadata must continue to fail closed. This
   is not a source change authorized by this review.

## Codex → Claude combination and limitation

The concrete bounded combination is:

- Codex side: `gpt-5.6-luna` + `xhigh` (locally authoritative native
  app-server result; the OpenAI model catalog also lists `gpt-5.6-luna` with
  `none, low, medium, high, xhigh, max`; see
  [OpenAI model catalog](https://developers.openai.com/api/docs/models)).
- Claude side: `claude-opus-4-7` + `xhigh` is a documented Claude model/effort
  pairing and the installed CLI accepts the flag, but the local operator source
  does not currently publish that exact model plus effort metadata. Therefore
  this handoff is **not locally verified or spawn-authorized** until an
  operator config/registry supplies the exact entry. Account/plan access is a
  separate runtime concern.

`gpt-5.6-luna` + `xhigh` on Claude is intentionally **not** claimed. A Claude
  gateway alias or custom deployment may use that identifier, but without a
  trusted operator entry its effort is `UNVERIFIED`; no silent fallback or
  model substitution is allowed.

## Recommendation / controller action

Adopt option 1 for OpenCode and option 2 for Claude, keeping option 3 only if
the controller separately changes the mandatory-effort contract. The smallest
implementation surface is the capability catalog parser plus the runtime
launch-argument mapper; preserve the canonical requested/effective fields and
surface the exact variant/effort source. Until then, the current 422
`UNVERIFIED/MODEL_EFFORT_METADATA_UNAVAILABLE` behavior for OpenCode or Claude
with a requested effort is the correct fail-closed result, not a reason to
silently downgrade.

Verdict: **DESIGN READY / IMPLEMENTATION NOT AUTHORIZED IN THIS ROUND**.
