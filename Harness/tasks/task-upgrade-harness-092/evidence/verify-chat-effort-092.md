# AC-05 structured-chat effort verifier (independent RED → GREEN)

Date: 2026-09-09

This is an independent test-writer review. Only the new
`tests/review-chat-effort-092.test.js` was added for this check; no runtime,
schema, contract, benchmark, version, git, or user configuration file was
changed by the verifier. The test uses a `makeHarnessTempRoot()` project and
test-owned chat, PTY-fallback, stdio, and HTTP recorders. It never invokes a
paid provider or leaves a provider/PTY child running.

## GREEN command and result

```text
node --test tests/review-chat-effort-092.test.js
```

```text
tests: 4
pass: 4
fail: 0
skip: 0
exit code: 0
```

The complete post-author-fix run is GREEN. The test title retains its RED-first
label because this file was created as an independent RED; the result above is
the authoritative final status:

1. The real `POST /api/sessions` initial and unique retry OpenCode
   `transport:chat` dispatches reach `spawnChatRuntimeSession` with an exact
   `openai/gpt-5.6-luna` model, `xhigh` effort, and trusted variant. The retry
   creates a distinct chat-driver entry and the test-owned PTY-fallback
   recorder remains at zero.
2. The real Codex app-server adapter now emits `turn/start.params.effort` on
   both initial and subsequent turns, retaining the exact model.
3. The real Claude stream-json adapter now emits `--effort xhigh` in native
   argv across two turns; the legacy no-effort case still omits that flag.
4. The real OpenCode server adapter now sends exact model and trusted top-level
   `variant` on both `/prompt_async` bodies, with no invented
   `reasoning_effort` field.

The historical author-pre-fix RED was also independently observed as 4 tests,
0 pass, 4 fail, exit 1: initial server effort/variant, Codex JSON-RPC effort,
Claude argv effort, and OpenCode top-level variant. After the author changes,
those three native assertions were GREEN while the server retry transport
downgrade was the intermediate 3-pass/1-fail RED. The final run above verifies
that retry now remains chat and preserves the same fields.

The test also contains a legacy Claude assertion that omitting effort does not
invent an `--effort` flag; it executed and passed in the complete post-fix
GREEN run above.

## Contract/protocol evidence used

- Codex's official generated v2 app-server
  [`TurnStartParams.ts`](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts)
  defines `effort` as the reasoning-effort override for the turn and subsequent
  turns. The verifier therefore checks the actual JSON-RPC `turn/start` wire
  request, not merely a constructor option.
- Claude Code's official
  [model configuration documentation](https://code.claude.com/docs/en/model-config)
  documents the `--effort` launch flag. The verifier checks the actual spawn
  argv and sends two stream-json user turns through the same child.
- OpenCode's official
  [server API documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx)
  documents the session message `model`/`parts` request shape. The upstream
  [server compatibility adapter](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/utils/server-compat.ts)
  passes the selected model `variant` alongside the prompt. The verifier checks
  both actual `/prompt_async` request bodies and requires the trusted
  model-level variant to remain exact; it does not invent a
  `reasoning_effort` OpenCode field.

## Scope handoff

The structured chat path is declared valid by the dispatch transport contract,
so disabling `chat` would not satisfy this review. The author supplied the
minimal retry `uiMode` mapping, and the independent test now verifies initial,
subsequent/retry, model identity, variant isolation, no silent PTY downgrade,
and legacy no-effort behavior. Teardown was verified with the test-owned
fallback recorder and explicit stop endpoint; the GREEN exits with a complete
summary and no temporary-root leak from the current run.
