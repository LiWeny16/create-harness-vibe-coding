# Release portability / context-budget independent verification

Date: 2026-09-09 (Asia/Shanghai)  
Scope: read-only verification of the portability/context-budget lane, plus one
separately authorized chat-retry source connection. No version, package,
canonical task state, A2A state, publish, stage, commit, or push was performed.
No A2A state contents were read.

## Portability finding

The previously coupled context test is now self-contained. `tests/verify-context-memory-092.test.js`
copies `tests/fixtures/harness-092/project` into a test-owned
`makeHarnessTempRoot()` directory and runs `Harness/scripts/task-context.mjs`
against the copied `task-context-fixture`; it does not name or read
`task-upgrade-harness-092`, its evidence directory, or the development task
state. The fixture state uses only the fixture task ID and fixture-local
evidence pointer. The targeted search over that test, fixture, context scripts,
and related tests found no current-task/evidence runtime path.

The test-owned roots are under `Harness/.temp` and are removed by the test's
`afterEach`; this verification created no separate temporary root and removed
no user files.

## Budget finding

`node Harness/scripts/context-budget.mjs --json` exited **0**. The observed
`cache-diagnostics-route` is **35702 / 36000 bytes**, leaving 298 bytes of
headroom. The frozen hard limit is still `maxBytes: 36000` in both the root and
template scripts; no code or test raises it. All four route profiles reported
`PASS` with no missing files. This is a route regression guard, not a provider
token or runtime exclusion rule.

## Commands and final exit codes

```text
node Harness/scripts/context-budget.mjs --json                         exit 0
node --test tests/context-budget.test.js tests/verify-context-memory-092.test.js
                                                                       exit 0 (6/6)
node --test tests/anti-drift.test.js tests/task-context.test.js \
  tests/memory-context.test.js tests/research-policy.test.js             exit 0 (43/43)
node --test tests/context-budget.test.js tests/verify-context-memory-092.test.js \
  tests/anti-drift.test.js tests/task-context.test.js tests/memory-context.test.js \
  tests/research-policy.test.js                                         exit 0 (49/49)
git diff --check -- <owned portability docs and mirrors>                exit 0
node --check src/wf-ui-server/server.mjs                                exit 0
```

The 49-test run completed in about 1.85 seconds and collected a final exit
code; no timeout was treated as a version result.

## Root/template parity in the verified framework scope

SHA-256 and byte-length comparisons returned equal for each pair below:

```text
Harness/scripts/README.md                         7531  BF9DC8753F99CE8F7F776B4B6A3269DA3F604E9586E461C4DCFF6F840A95146A
templates/common/Harness/scripts/README.md       7531  same
Harness/specs/runtime/context-loading.md        12570  A1119A07E392FEB42CD10CBD87E23CE68E4D95522FACFDD8159F7AC8D2BC7612
templates/common/Harness/specs/runtime/context-loading.md
                                                  12570  same
Harness/specs/runtime/dispatch.md                7521  39AFC8C3702825105D2025C4C6875D90D7C345564DF1AFCE935AEC0BC0C4850E
templates/common/Harness/specs/runtime/dispatch.md
                                                   7521  same
Harness/scripts/context-budget.mjs                2951  FA80B25DE4683B74FB7F61455E6C4B53D8A392FBD3C7616AC21E524C6B2580DF
templates/common/Harness/scripts/context-budget.mjs
                                                   2951  same
Harness/memory/startup-hints.md                   1491  637329A013A9BD4B4B96E44AE317733F4DA97B77714A94E227DE597318FF7027
templates/common/memory/startup-hints.md         1491  same
Harness/scripts/task-context.mjs                 26100  2795A9094C1E0EED9B147CD97B6CB4C97FD1C03BB95D3E6BD5D59446DFE55F80
templates/common/Harness/scripts/task-context.mjs
                                                  26100  same
Harness/scripts/memory-context.mjs                2755  A339FF07BE34AAF04053A64E8766F655C99945EE6781ADCC6681E813B92958B3
templates/common/Harness/scripts/memory-context.mjs
                                                   2755  same
Harness/scripts/research-policy.mjs               1554  D7769CF2FDF114973D7C3C66EEB8DAA152AFA613D41372378E880EEA35A6480E
templates/common/Harness/scripts/research-policy.mjs
                                                   1554  same
Harness/scripts/lib/memory-context.mjs           18560  604CC1156A538FD1F70BA22AF144A4AB8F11272C433EEC801E68423E37CC0234
templates/common/Harness/scripts/lib/memory-context.mjs
                                                  18560  same
Harness/scripts/lib/path-scope.mjs                3639  401A0D4C33D9CE69EB01930C3D7E9F10EB04B9CAA5E41DC22271943BA03AE9DE
templates/common/Harness/scripts/lib/path-scope.mjs
                                                   3639  same
Harness/scripts/lib/research-policy.mjs           5844  5A4EDC4A5854291110175C52D4A8938BC4807E656196A3797B4E77EFB9A97252
templates/common/Harness/scripts/lib/research-policy.mjs
                                                   5844  same
```

Project/user memory files outside this fix scope are not release parity
claims. They are state surfaces and should not be used to infer a template
source mismatch.

## Separate chat-retry connection (not a portability verdict)

The independent chat verifier's RED identified a missing transport mapping on
the retry path. The only authorized source change is
`src/wf-ui-server/server.mjs:4853-4869`, in the retry
`createRuntimeSession` payload: it now passes
`uiMode: request.payload.transport === 'chat' ? 'chat' : 'pty'`. The initial
dispatch mapping and model/effort/variant fields are unchanged. The source
check above exited 0.

Local observation after that one-line connection was:

```text
node --test tests/review-chat-effort-092.test.js                         exit 0 (4/4)
node --test src/wf-ui-server/__tests__/server.integration.test.mjs \
  tests/runtime-review-backend.test.js tests/runtime-dispatch-cli.test.js  exit 0 (45/45)
```

This is an implementation observation only; the original independent chat
verifier remains the authority for chat acceptance. No claim is made here
about the separate PTY/model/auth implementation or its release readiness.

## Selective release-stage recommendation (advisory; nothing staged)

Include exact reviewed repository source paths, subject to the release owner's
final diff review:

- static evaluator source under `benchmarks/harness-intelligence-092/`,
  including its manifest, schema, README, evidence template, sentinel,
  prompts, and B2 static handoff/data fixtures; these are repository test
  inputs, not npm package payload;
- repository tests and static fixtures under `tests/`, including the new
  context test and `tests/fixtures/harness-092/**`, plus runtime test fixtures;
- the corresponding `templates/common/**` source and only explicitly reviewed
  root dogfood mirrors proven byte-equal to it;
- production source and scripts selected by the release owner, including the
  reviewed context scripts and the authorized `server.mjs` connection.

Exclude from stage: `Harness/tasks/**` (active/archive/current task and its
evidence), `Harness/a2a/**` runtime/node state, `Harness/.temp/**` and
`Harness/.runtime/**`, screenshots/user assets, and benchmark raw run output
or heldout/private material (`runs/**`, `results/**`, `holdout/**`,
`private/**`). Do not exclude the whole static benchmark directory, whole
`tests/fixtures`, or whole root dogfood tree merely because excluded state
also exists nearby. No `git add .` or stage operation was run.

Portability matrix is green and the 36000-byte guard is intact. Release
candidate versioning, clean-checkout packaging, and final independent chat
sign-off remain release-owner decisions.
