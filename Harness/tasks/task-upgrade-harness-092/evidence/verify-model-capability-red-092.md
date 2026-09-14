# Independent model-capability RED verification (2026-09-09)

Scope: test-only, server-construction DI contract for AC-05.  No production,
canonical task state, version, docs, or benchmark scorer was changed by this
lane.  The test-owned probe is the only authority: `gpt-5.6-luna` is listed
with `low|medium|high|xhigh`; `gpt-9-model-does-not-exist-092` is absent from
the complete catalog.  HTTP payload catalog claims are intentionally ignored.

## Command evidence

| Command | Result |
|---|---|
| `node --test src/wf-ui-server/__tests__/runtime-review.test.mjs` | 27 total: 16 pass, 11 fail; 10 newly-added capability REDs plus the retained unknown-model RED. |
| `node --test tests/anti-drift.test.js` | 21/21 pass. |

The REDs are intentional and establish the pre-fix baseline: the current
server does not yet consume `modelCapabilityProbe`, so the supported Luna
probe is not called and rejected probe outcomes still spawn/return HTTP 201.
The pre-existing unknown-model case also remains a 201 instead of the
expected 422 `UNSUPPORTED`; it is retained and not weakened.

## Independent RED coverage

- authoritative catalog hit receives exact runtime/model/effort/projectRoot
  and a finite `deadlineAt`;
- probe-result model mismatch fails closed;
- `unverified`, missing/malformed, and thrown probe outcomes fail closed;
- supported result without effort metadata cannot invent `xhigh`;
- an explicit effort exclusion returns unsupported;
- caller-supplied HTTP `modelCapability`/`supportedModels` cannot authorize the
  absent gpt-9 model;
- concurrent identical dispatches call the probe once and preserve one PTY;
- an unavailable/timeout decision is cleaned up so a later identical request
  can probe again and succeed.

Every rejected capability case asserts no recorder spawn and no task-bound
`sessions` or `peers` state.  The tests use `makeHarnessTempRoot` and remove
only roots under `Harness/.temp`; no private cache implementation is assumed.

Status: RED handoff to the runtime source worker; do not claim model-capability
behavior is implemented until this suite turns green while the retained
unknown-model negative test remains strict.
