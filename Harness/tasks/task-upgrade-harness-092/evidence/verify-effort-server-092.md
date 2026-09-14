# AC-05 effort/server boundary verification

Date: 2026-09-09
Role: independent test-writer/verifier (Luna xhigh)

## Scope and isolation

`tests/review-effort-server-092.test.js` is the only new executable test file
in this verification wave. It uses the real `POST /api/sessions` HTTP route,
the injected test-authoritative capability probe, the server's real dispatch
path, and the existing test-owned PTY recorder. No paid provider, prompt,
thread, turn, or inference request is made. Every project root is created by
`makeHarnessTempRoot` and removed by `afterEach`.

The tests cover:

- Codex, Claude, and OpenCode initial dispatch plus the one explicit retry,
  checking that `effort` and the model-level OpenCode `effortVariant` reach the
  PTY seam on both spawns and that response requested/effective selections stay
  exact.
- HTTP settings attempts to add, replace, null, or nest
  `runtimeCapabilities`, while ordinary UI/cleanup settings remain writable
  and the pre-existing operator declaration remains unchanged.
- HTTP-provided `modelCapability`/`supportedModels`/runtime declarations cannot
  self-authorize an unknown model; an existing exact operator declaration can
  still dispatch.
- A test-owned OpenCode catalog containing both
  `opencode/gpt-5.6-luna` and `opencode-go/gpt-5.6-luna`, proving that a bare
  `gpt-5.6-luna` must be rejected as ambiguous rather than silently routed to
  one provider. An explicit provider/model must pass unchanged to the PTY.

## RED checkpoint

Command:

```text
node --test tests/review-effort-server-092.test.js
```

Observed result during the verifier checkpoint:

```text
3 passed, 1 failed
```

The failing business assertion is:

```text
AC-05 RED: ambiguous bare OpenCode model is rejected and explicit provider/model reaches PTY unchanged
AssertionError: ambiguous bare model must not spawn
actual response: HTTP 201, requested.model = gpt-5.6-luna,
effective.model = gpt-5.6-luna, spawnPty reached once
```

This is a real boundary failure, not a missing export or syntax check. The
test-owned authoritative catalog has two provider-qualified entries for the
same bare model name. The server currently accepts the bare name, writes the
bare name in both requested/effective selections, and reaches the PTY seam;
the test therefore preserves the RED until the author makes the ambiguity
explicitly fail (or requires a provider-qualified request). The explicit
`provider/model` branch is already checked in the same real HTTP test.

The other three checks passed at this checkpoint because parallel author work
had already connected effort/variant through the server and added the HTTP
operator settings guard before this test was executed:

```text
AC-05 real dispatch effort/variant initial + retry       PASS
AC-05 HTTP settings trust boundary                       PASS
AC-05 HTTP self-authorized model + trusted operator      PASS
```

## Verification handoff

The independent review test and all benchmark/canonical/version/git files are
untouched. No source change, publish, stage, commit, push, provider call, or
user-config mutation was performed by this verifier. After the ambiguity
author reports the fix, rerun this exact command, then run the relevant backend
regression matrix before declaring GREEN.

## Independent GREEN rerun

The author reported the ambiguity fix. The unchanged verifier file was rerun:

```text
node --test tests/review-effort-server-092.test.js
5 passed, 0 failed
```

This includes the three-runtime initial/retry effort and variant assertions, all
HTTP settings mutation forms, HTTP self-authorization rejection with trusted
operator positive control, and the two-provider OpenCode ambiguity fixture.
The bare model now fails closed before `spawnPty`; explicit
`opencode/gpt-5.6-luna` remains exact in requested/effective/PTY observations.

The additional UI-shape verifier follows the actual frontend implementation:
`src/ui/src/components/SettingsRoute.tsx:98-134` GETs settings, preserves the
returned fields in local state, and POSTs the full state on save. A full GET
round-trip with only `ui.theme` changed returned 200 and preserved the exact
operator declaration.

Related backend/API/PTY regression matrix:

```text
node --test src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs src/wf-ui-server/__tests__/pty-adapter.test.mjs src/wf-ui-server/__tests__/settings.test.mjs src/wf-ui-server/__tests__/runtime-detector.test.mjs src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs src/wf-ui-server/__tests__/runtime-review.test.mjs
63 passed, 0 failed
```

The matrix explicitly passed unknown-effort rejection, no-effort-metadata
fail-closed behavior, model-level OpenCode variant isolation, bare-model
provider ambiguity rejection, retry/new-session lifecycle, and settings
preservation. CLI/legacy regression also passed:

```text
node --test tests/runtime-dispatch-cli.test.js tests/verify-runtime-release-cli-project.test.js tests/cli-smoke.test.js tests/runtime-review-backend.test.js src/wf-ui-server/__tests__/control-plane-cli-smoke.test.mjs src/wf-ui-server/__tests__/workflow-cli-surface.test.mjs
60 passed, 0 failed, 1 skipped. The one skip is the test named
`interactive fallback previews computed conflict plan before generation failure`
in `tests/cli-smoke.test.js:302`; it is explicitly skipped because this run's
stdout is not a TTY (`skip: !process.stdout.isTTY`), so it is not counted as a
pass.
```

The main server integration suite passed:

```text
node --test src/wf-ui-server/__tests__/server.integration.test.mjs
42 passed, 0 failed
```

## Release-readiness conclusion

AC-05 effort/server/provider identity has no remaining HIGH/MEDIUM blocker in
this verifier scope. The unchanged historical missing-effort metadata
assertion in `tests/review-cross-contract-092.test.js` remains an
independent-reviewer follow-up, not a B3 failure. Full release gates, version/mirror
synchronization, paid-provider execution, browser UI evidence, and any
post-push benchmark remain outside this check.

Conclusion: **可进入 candidate release checks，非 post-push benchmark PASS。**
