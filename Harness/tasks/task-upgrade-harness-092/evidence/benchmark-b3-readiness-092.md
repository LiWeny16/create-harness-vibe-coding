# B3 fresh-candidate readiness: Claude operator capability boundary

Date: 2026-09-09  
Role: benchmark evaluator-prep/verifier (not an independent scorer)

## Determination

The user-authorized quick probe proves that the configured Claude CLI can
complete a no-tools request with exact `modelUsage` model
`gpt-5.6-luna`. Its `xhigh` evidence is **requested-only** because the CLI
JSON did not echo an effort field. It must not be recorded as native/provider
effort verification and does not, by itself, satisfy the strict B3 gate.

For a fresh candidate project, the existing implementation requires an
explicit operator setup in the candidate project's `Harness/settings.json`:

```json
{
  "runtimeCapabilities": {
    "claude": {
      "models": {
        "gpt-5.6-luna": { "supportedEfforts": ["xhigh"] }
      }
    }
  }
}
```

This is a pre-run **operator-configured intervention**, not a provider/native
catalog claim. It must be listed separately from benchmark outcomes and must
not be supplied through an HTTP dispatch payload or ordinary settings save.
This setup is documented here only; no candidate or user settings were
written in this preparation phase.

## Existing loading and gate chain

The current source-backed chain is:

1. `settings.mjs:DEFAULT_SETTINGS` permits the optional Harness-owned
   `runtimeCapabilities` field. `loadSettings(projectRoot)` deep-merges the
   project `Harness/settings.json` while ignoring unrelated unknown keys.
2. `model-capability.mjs:readHarnessRuntimeCapabilities(projectRoot,
   'claude')` reads that merged field, requires an exact model-key match, and
   normalizes `supportedEfforts` to lower-case names.
3. `operatorCapabilityResult` returns `status=supported`,
   `sourceKind=harness-operator-runtime-capabilities`,
   `verificationLevel=operator-configured`, and the declared effort list for
   that exact Claude model. With a declaration present, the Claude branch of
   `probeModelCapability` uses it before the no-catalog `unverified` result.
4. `assertModelCapability` still checks complete/trusted provenance, exact
   returned model identity, and inclusion of requested `xhigh` in
   `supportedEfforts`; it does not relabel operator-configured data as
   authoritative/provider-verified.
5. The dispatch server passes the canonical runtime/model/effort to
   `preflightDispatchModel` before dispatch state, context materialization, or
   spawn. Initial and explicit retry each repeat the preflight, then preserve
   exact `requested`/`effective` selections and the operator provenance on the
   session response. The existing one-retry/idempotency contract remains in
   force.

For this setup, a `claude` dispatch may therefore be accepted as
`operator-configured`; that acceptance is an explicit benchmark intervention,
not evidence that upstream Claude's gateway catalog independently advertises
`xhigh` for the model. OpenCode is different: the current operator schema
cannot identify an exact provider variant for an effort and its implementation
keeps such an effort unverified.

## Minimal fresh-candidate execution plan

1. Install the exact pushed candidate in a new project directory and record
   SHA/package hash before creating the operator declaration above.
2. Record a hash/snapshot of the operator declaration and label its provenance
   `harness-operator-runtime-capabilities / operator-configured`.
3. Use the existing configured Claude gateway/auth without changing user
   settings. Start the CLI-only backend for that same absolute project; do not
   use `--fallback-model` or silently substitute another model.
4. Send the B3 dispatch with exact `runtime=claude`,
   `model=gpt-5.6-luna`, `effort=xhigh`, and the declared transport. Capture
   the real POST response, request/ACK/RESULT correlation, terminal sequence,
   cancellation/failure state, and the one explicit retry.
5. Verify both initial and retry retain exact requested/effective model and
   effort, and that the real CLI's model telemetry remains
   `gpt-5.6-luna`. A missing provider effort echo remains
   `requested-only`, not a pass for native effort proof.
6. Replay the identical dispatch and verify `replayed:true`, no second
   session/worker, and no duplicate result-file side effect. Do not mutate the
   operator declaration through `/api/settings`; ordinary UI settings may be
   changed only if the exact declaration remains byte/structure-equivalent.
7. Record setup intervention, source provenance, runtime/model/effort, n,
   retries/rework/recovery, side effects, and estimated versus providerMeasured
   metrics separately. A single successful run is a smoke result, not a
   benchmark generalization.

## Quick-probe telemetry boundary

The retained quick-probe evidence can report the following known fields from
the exact `gpt-5.6-luna` `modelUsage` entry:

```text
inputTokens, outputTokens, cacheReadInputTokens,
cacheCreationInputTokens, costUSD, contextWindow
```

The raw JSON capture was not retained, so the complete set of all
`modelUsage` keys is **unknown**; the list above is only the captured
allow-listed subset. The CLI aggregate `total_cost_usd` was
`0.015137000000000001`, while the exact model entry `costUSD` was
`0.014725000000000002`. They are distinct telemetry scopes (aggregate CLI
cost versus the model entry); the difference is `0.000412`, and no causal
provider accounting meaning may be inferred from this smoke sample.

## Readiness boundary

Ready for a post-push fresh-candidate B3 run **only with the explicit,
operator-configured setup recorded as an intervention**. The quick probe
reduces connectivity uncertainty and confirms actual model identity, but does
not prove provider/native `xhigh`. No source, scorer, test, STATE, user
configuration, sealed holdout, version, or Git state was changed here, and no
additional model request was made.
