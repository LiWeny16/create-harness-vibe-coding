# Server version boundary verification

Date: 2026-09-09  
Role: independent test-writer/verifier (Luna xhigh)

## Scope

Added only `tests/review-server-version-092.test.js`. The test starts the
real `src/wf-ui-server/server.mjs` on an owned loopback port using a project
root from `makeHarnessTempRoot()`, calls the real `GET /api/health` endpoint,
and compares its response to `package.json.version` read at runtime. It does
not hard-code the expected release version, use a source regex, invoke a
provider, or start a user backend. The server and temporary root are cleaned
up in `finally`.

## Independent RED

Command:

```text
node --test tests/review-server-version-092.test.js
```

Complete result:

```text
tests: 1
pass: 0
fail: 1
skip: 0
exit code: 1
```

The real HTTP response was `200` with `status: "ok"` but reported
`version: "0.9.1"`; the dynamically loaded package version was `"0.9.2"`.
The failing assertion was therefore the externally observable server/package
version mismatch. No production source was changed by this verifier.

## Independent GREEN rerun

The author supplied the minimal source change: `SERVER_VERSION` is loaded from
the module-owned `../../package.json` through `fs`/`fileURLToPath`, with an
explicit `unknown` fallback if metadata is unavailable. The existing
`/api/project` path still reads the target project's `Harness/.harness-version`
manifest, so project-local manifest semantics remain unchanged.

Commands:

```text
node --test tests/review-server-version-092.test.js
node --test tests/review-server-version-092.test.js src/wf-ui-server/__tests__/server.integration.test.mjs
```

Results:

```text
version test: 1 passed, 0 failed, 0 skipped, exit code 0
combined HTTP/server integration: 43 passed, 0 failed, 0 skipped, exit code 0
```

The combined run exercised the real `/api/health` response and the existing
server integration surface; the expected version came only from the runtime
`package.json` read in the new test. A post-run scan found zero leftover
`review-server-version-092-*` Harness temp roots. This verifier started no
child process, and no provider/inference call was made.

## Handoff

The minimal production fix belongs to `fix_runtime_review_092`: make the
server's externally reported version derive from the package release identity
without changing legacy endpoint shape. After that source change, rerun the
exact command above and record the complete exit summary. This evidence is a
RED report only; it is not a release or post-push benchmark approval.
