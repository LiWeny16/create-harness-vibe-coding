# Claude quick connectivity probe

Date: 2026-09-09  
Role: independent Luna xhigh proxy/verifier

## Invocation boundary

The user-authorized probe used a fresh Claude CLI process in the empty,
project-independent directory:

`D:\HarnessBenchmarks\harness-092-20260909-SGWTir\future-executions\claude-quick-358a8a21`

The prompt was exactly: `Reply exactly HARNESS_CLAUDE_OK. Do not use tools.`
The process used the existing Claude settings/authentication, with inherited
`HARNESS_*` node-identity variables removed from its environment. It passed
`--print`, `--model gpt-5.6-luna`, `--effort xhigh`, JSON output, empty tools,
strict MCP isolation, `--no-session-persistence`, and
`--max-budget-usd 0.25`. No `--fallback-model`, resume, alternate model, or
provider was used. No development repository or sealed evaluation directory
was read.

## Result

```json
{
  "exitCode": 0,
  "signal": null,
  "timedOut": false,
  "type": "result",
  "subtype": "success",
  "isError": false,
  "result": "HARNESS_CLAUDE_OK",
  "actualModel": "gpt-5.6-luna",
  "modelUsageExactTargetPresent": true,
  "durationMs": 1712,
  "durationApiMs": 2765,
  "totalCostUsd": 0.015137000000000001,
  "usage": {
    "input_tokens": 2745,
    "output_tokens": 40,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "service_tier": "standard"
  },
  "effortEvidence": { "kind": "requested-only", "value": "xhigh" },
  "fallbackDetected": false
}
```

The exact `modelUsage` entry for `gpt-5.6-luna` was present and reported
`inputTokens=2745`, `outputTokens=40`, `costUSD=0.014725000000000002`, and
`contextWindow=200000`. The provider did not echo an effort field, so `xhigh`
is confirmed as the CLI request selector only, not as an independently
provider-reported effort capability. This is a connectivity/smoke result, not
a benchmark or strict effort-capability proof.

The owned process PID was `5664`; it exited and was confirmed absent after the
run. The quick-probe directory remains empty. No fallback warning, provider
error, or cleanup leak was observed.
