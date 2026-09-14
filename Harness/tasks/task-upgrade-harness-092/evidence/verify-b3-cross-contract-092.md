# Independent B3 cross-contract verification (092)

Date: 2026-09-09. Reviewer: independent Luna xhigh runtime/readiness lane.

## Scope

This is a bounded re-run of the existing real-server cross-contract test. It
does not widen the benchmark and does not edit runtime/server, contracts,
benchmark schema, canonical state, version, Git, or A2A state. The only source
test changes in this lane are the owned B3 scorer assertion and effort-case
oracle in `tests/review-cross-contract-092.test.js`.

## Commands and results

```text
node --test --test-name-pattern="independent cancellation plus one retry" tests/review-cross-contract-092.test.js
1 passed, 0 failed

node --test tests/review-cross-contract-092.test.js
2 passed, 0 failed

opencode --version
1.18.4

opencode models --help
--pure and --verbose are supported; --verbose includes model metadata.

node --input-type=module -e "import {probeModelCapability} from './src/wf-ui-server/model-capability.mjs'; const r=await probeModelCapability({runtime:'opencode',model:'opencode/gpt-5.6-luna',effort:'xhigh',projectRoot:process.cwd()}); console.log(JSON.stringify({status:r.status,sourceKind:r.sourceKind,verificationLevel:r.verificationLevel,complete:r.complete,model:r.model,supportedEfforts:r.supportedEfforts,effortVariant:r.effortVariant,catalogModelId:r.catalogModelId}))"
status=supported; sourceKind=opencode-models; verificationLevel=authoritative;
model=opencode/gpt-5.6-luna; supportedEfforts=none,low,medium,high,xhigh,max;
effortVariant=xhigh; catalogModelId=opencode/gpt-5.6-luna
```

Both owned tests are now green. The effort test intentionally covers both
catalog states: a test-owned authoritative entry that omits `supportedEfforts`
returns `422 UNVERIFIED` with zero spawns, while the same exact
`opencode/gpt-5.6-luna` entry with `supportedEfforts: ["xhigh"]` returns `201`
and reaches the fixture once. An unsupported effort returns `422 UNSUPPORTED`
with zero spawns. An isolated Claude `.claude/settings.json` containing only
`availableModels: ["gpt-5.6-luna"]` also returns `422 UNVERIFIED`; a model
string is not effort metadata. No silent model replacement or Opus fallback
was used.

The native OpenCode probe was read-only catalog discovery (no prompt, turn,
inference, or provider credential output). OpenCode 1.18.4's verbose catalog
currently contains both `opencode/gpt-5.6-luna` and `opencode-go/gpt-5.6-luna`
with an explicit `xhigh` variant. The exact provider/model positive was used;
the bare-model ambiguity is covered by the separate effort-server test.

## What was independently checked

- A cancellation dispatch and a separate failed dispatch were created through
  the actual HTTP server boundary.
- The failed dispatch's single explicit retry returned `201`, had a distinct
  session, and returned `attempt: 1`; the initial server response had
  `attempt: 0`.
- Replay of the retry returned `200` with `replayed: true`, the original retry
  session, and no additional fixture spawn. The recorder count remained three:
  cancellation + failed initial + one retry.
- The scorer result for the joined evidence was `pass`, with one retry
  (`currentAttempt: 2` in normalized benchmark evidence), the retry dispatch
  and retry session identified, three dispatch effects, and one result write.
- Existing stale-`replyTo` and second-retry negative cases remain in the
  scorer's independent suite; they were not weakened by this update.
- The owned effort oracle records requested/effective preservation and PTY
  forwarding for the exact provider/model positive, while preserving the
  fail-closed missing-metadata and unsupported-effort negatives. It does not
  treat a native metadata-backed `201` as a product failure.

## Raw versus normalized attempt trace

The runtime uses a 0-based raw attempt (`initial=0`, `retry=1`), while the
benchmark evidence schema uses 1-based normalized attempts (`initial=1`,
`retry=2`). The test now asserts the actual HTTP response values and writes
both fields in every synthetic evidence row:

```text
raw runtime attempts: [0, 0, 1]
normalized evidence: [1, 1, 2]
```

`rawAttempt` is preserved alongside `attempt`; the execution evidence records
the mapping. The scorer consumes the explicit normalized `attempt` field and
does not require mutating the raw server response/log. This is acceptable
only because the mapping is explicit and independently asserted here. A
future benchmark schema should make the normalizer/provenance first-class;
the current scorer does not itself validate an arbitrary `rawAttempt` field.

## Contract conclusion

The legitimate frozen-contract shape is now independently accepted:

```text
independent cancellation dispatch
        + separate failed dispatch --one retry/new session--> success
        + replay => no new spawn/write
```

This does not close AC-05 or AC-09. Real paid-provider Luna B3 remains pending,
and strict Claude `gpt-5.6-luna/xhigh` execution requires user confirmation of
a Claude gateway and non-sensitive model/effort configuration before any such
run. The former OpenCode missing-metadata expectation is not a product HIGH:
native metadata is present and the owned test now separately proves the
fail-closed behavior when that metadata is absent.
