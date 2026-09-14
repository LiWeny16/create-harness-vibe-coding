# Claude catalog readiness (read-only)

Date: 2026-09-09  
Role: independent catalog-readiness verifier (Luna xhigh)

## Safety and source boundary

This check used only the installed Claude CLI/help surface and the existing
user settings object. It did not read the credentials store, print any gateway
address, token, header, or response body, modify settings, start a session, or
invoke messages/completions/inference. No benchmark was run.

The installed CLI is Claude Code `2.1.215`. Its help exposes `--model` and
`--effort` (including `xhigh`) but no model-catalog command. A CLI selector is
not provider capability evidence.

The user settings object was inspected only for allow-listed key presence and
non-sensitive selector values: it contains `model=fable`, `effortLevel=xhigh`,
`env.ANTHROPIC_BASE_URL`, and `env.ANTHROPIC_AUTH_TOKEN`. Their values were
kept in memory; neither the gateway address nor token was output or persisted.
No model allowlist or model-specific effort metadata for
`gpt-5.6-luna` is declared locally.

The official [Anthropic Models API list reference](https://platform.claude.com/docs/en/api/models/list)
defines the standard authenticated `GET /v1/models` catalog and the
`data[].id` / `data[].capabilities.effort` fields used by this check. The
[Claude Code gateway guidance](https://docs.anthropic.com/en/docs/claude-code/llm-gateway)
was used only to retain the configured gateway boundary; no request was
redirected to the public Anthropic host.

## Bounded catalog probe

The first local implementation did not reach the network: Windows
PowerShell/.NET failed at the `client-create` stage because
`System.Net.Http.HttpClient::new()` raised a `RuntimeException` (numeric
HResult only: `-2146233087`). This was a local invocation incompatibility, not
provider evidence.

After that diagnosis, one Node built-in `fetch` invocation was made to the
same configured gateway, with the path normalized to the standard
`/v1/models` path, `Authorization: Bearer` from the existing settings token,
and `anthropic-version: 2023-06-01`. It used an 8-second abort bound, manual
redirect handling, and a 64 KiB response cap. The local `Request` construction
was independently valid (`GET`, configured HTTP scheme, and auth header
present).

The bounded fetch invocation entered `request-dispatch` but completed with no
HTTP status. The transport result was a generic Node `TypeError` with no
non-sensitive error code. Because no HTTP response body was obtained, the
catalog fields cannot be classified:

```json
{
  "requestAttempted": true,
  "httpStatus": null,
  "exactModelPresent": null,
  "effortFieldPresent": null,
  "effortSupportsXhigh": null,
  "outcome": "unknown-request-failed"
}
```

No retry, alternate path, alternate host, or provider was attempted.

## Conclusion

`gpt-5.6-luna` presence and its `xhigh` effort capability remain **unknown**.
The configured Claude gateway therefore does not reduce the existing strict
Claude/B3 capability blocker. Do not substitute `fable`, Opus, or another
model, and do not treat `--model gpt-5.6-luna --effort xhigh` alone as a
provider commitment. A future check needs a normal, bounded catalog response
from this same configured gateway or another explicitly authorized
non-inference catalog mechanism.
