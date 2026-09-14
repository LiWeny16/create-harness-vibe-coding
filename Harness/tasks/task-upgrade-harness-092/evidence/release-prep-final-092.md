# 0.9.2 release-prep final read-only inventory

Date: 2026-09-09 (Asia/Shanghai)

## W6 current candidate checkpoint (supersedes stale observations below)

This section is the current release-prep record after the bounded W6 version
candidate work. The older inventory below is retained as historical context and
must not be read as the current command result.

Candidate metadata now reads `package.json` version **0.9.2** with a dated
`CHANGELOG.md` `## [0.9.2]` entry. The entry is intentionally bounded: it
describes the implemented dispatch/model/effort/context checks and explicitly
does not claim the remaining intelligence goals, fresh-provider coverage, or a
real post-release benchmark are complete.

`node scripts/build-version.mjs` exited **0** and wrote exactly the four
approved generated outputs:

```text
templates/common/.harness-version
templates/common/Harness/ownership.manifest.json
Harness/.harness-version
Harness/ownership.manifest.json
```

The final generator output records generator `0.9.2`, 200 checksums, and 219
sources. No other path was written by the generator. `build-version --check`
and `check-root-harness-version.mjs` each exited **0**; the local script mirror
check exited **0**.

The initial read-only source inventory found
`src/wf-ui-server/server.mjs:181` with `SERVER_VERSION = '0.9.1'`. An
independent real-HTTP RED then confirmed `/api/health` exposed 0.9.1 while the
root package metadata was 0.9.2. Following that RED, the parent authorized the
minimal one-file source fix recorded below; the independent verifier's final
sign-off remains a separate review result.

### Current server-version use and minimal single-source recommendation

The read-only call-site audit is narrow and deterministic:

```text
src/wf-ui-server/server.mjs:181  const SERVER_VERSION = '0.9.1'
src/wf-ui-server/server.mjs:924  GET /api/health -> version: SERVER_VERSION
src/wf-ui-server/server.mjs:2402 GET /api/debug/state -> server.version: SERVER_VERSION
```

`GET /api/project` (lines 929-945) does not use `SERVER_VERSION`; it reads
`<projectRoot>/Harness/.harness-version` and returns that project-local
generator version, falling back to `unknown`. No other `SERVER_VERSION` call
site or separate server discovery/reuse endpoint was found in the source
inventory. This means the current 0.9.2 candidate can report 0.9.1 on health
and debug while the project endpoint and generated manifests report 0.9.2.

Existing repository code already reads package metadata using the compatible
filesystem pattern `JSON.parse(fs.readFileSync(..., 'utf8'))`:
`src/generator.js:67-70` reads `../package.json`, and
`scripts/build-version.mjs:168-170` reads `<root>/package.json`. No shared
package-version helper was found. The minimal separately-authorized fix is
therefore to replace the server literal with a guarded read of the package
root relative to `server.mjs` (the equivalent of
`path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')`)
and retain `unknown` on read/parse failure. This works from both the source
checkout and the installed package, avoids import-assertion syntax, and leaves
the project-local `/api/project` version semantics unchanged. This exact
guarded read is now applied in `server.mjs`; no helper, dependency, or other
server block was added.

Post-authorization local verification (the independent verifier remains the
authority for final acceptance) produced:

```text
node --check src/wf-ui-server/server.mjs                         exit 0
node --test tests/review-server-version-092.test.js              exit 0 (1/1)
node --test server.integration + runtime backend/CLI matrix     exit 0 (45/45)
node scripts/build-version.mjs --check                          exit 0
git diff --check -- src/wf-ui-server/server.mjs                  exit 0
```

Build/test gates completed with final exit codes:

```text
npm --prefix src/ui run build                                      exit 0
npm test                                                           exit 0 (383 tests: 382 pass, 0 fail, 1 platform skip)
npm run test:e2e                                                   exit 0 (174/174)
npm run pack:smoke                                                 exit 0 (3/3)
node scripts/harness-intelligence-bench.mjs --self-check            exit 0
```

The explicit runtime matrices also exited **0**: runtime/backend `74/74`,
driver/security `51/51`, and effort/cross-contract `13/13`. The strict
dogfood and template validators each exit **1** only for the pre-existing
missing `task-make-wf-lifecycle-0908/STATE.json` and six-outer-task cap
warnings; no task state was changed to hide those warnings.

`npm pack --dry-run --json` exited **0** for
`create-harness-vibe-coding@0.9.2` (714 files, 7,894,710 bytes). A corrected
payload check found zero forbidden actual-root entries: no root task/A2A
runtime state, temp/runtime directories, tests, benchmark raw/heldout/private
artifacts, debug UI artifacts, or scorer script. The package does intentionally
include the static `templates/common/Harness/a2a/action-registry.json` and
`templates/common/Harness/tasks/_template/**`, plus built UI dist and the three
documented `docs/images/*` assets.

`npm install` was not rerun in this dirty worktree: dependencies were already
present, and the ignored local lockfiles are explicitly outside this worker's
WriteSet. A clean candidate must still run the CI installation step before its
own final test collection.

The index currently has **no staged paths** (`git diff --cached --name-only`
was empty). The current HEAD already tracks four non-archive project task
capsules by name (`task-add-web-agent-node`, `task-fix-wf-ui-ux-issues`,
`task-homepage-act1-flat-layout`, and `task-simplify-skills-hub-pack-prompt`)
and 729 A2A state-like paths. These pre-existing tracked user/runtime surfaces
were not read or rewritten; a future clean exact-SHA validation must account
for them rather than silently deleting them.

Ownership boundary for selective staging: this W6 worker is authorized only for
`package.json`, the new `CHANGELOG.md` 0.9.2 entry, the four generated version
outputs, this release evidence, and the two separately authorized minimal
`src/wf-ui-server/server.mjs` connections (retry transport mapping and the
package-backed server version). The wider
0.9.1 candidate source/template/test set in the historical inventory is a
dependency to review, not proof that every dirty path belongs to this task.
Current UI/Skills-Hub and other project edits include unrelated user work and
possible mixed hunks; do not stage an entire file when ownership cannot be
proved. Split or defer those paths for the responsible owner.

The current index is empty, so no pre-existing staged path needs preservation.
At this checkpoint `git status --short` reports 206 paths (158 modified and 48
untracked), all unstaged; this count is an observation, not an ownership
claim, and may change as other workers finish.
The path-level dirty UI set (`Header.tsx`, `TaskList.tsx`, `WorkflowRoute.tsx`,
`WorkflowSkillsHubOverlay.tsx`, `i18n/translations.ts`, and `types.ts`) cannot be
assigned to this release worker from status alone and must be treated as
unrelated-or-mixed user work until its owner provides hunk-level attribution;
it must not be swept into the candidate as framework code. The same rule
applies to the existing Skills/CLI and unrelated task edits. Four non-archive
project task capsules are already tracked in HEAD by name, and their presence
is a clean-checkout/strict-validator risk, not permission to rewrite or remove
them. Root A2A state-like paths are likewise pre-existing tracked runtime
surfaces; only the explicitly reviewed `Harness/a2a/action-registry.json` is a
candidate source exception. Any future stage list must therefore be built from
proven hunks, never from a framework-directory glob or `git add .`.

The static benchmark fixtures under `benchmarks/harness-intelligence-092/`
and the repository-only evaluator `scripts/harness-intelligence-bench.mjs`
remain candidate test source (not npm payload); only raw runs/results and
heldout/private material are excluded. Likewise, `tests/fixtures/**`, the
new tests, `templates/common/Harness/tasks/_template/**`, and the explicitly
authorized `Harness/a2a/action-registry.json` are source candidates when their
owning changes are proven. Root task/runtime A2A state and user assets remain
excluded. This classification is advisory only; no staging was performed.

The online canonical/legacy main and tag observations below are historical
availability facts only. This candidate pass did not modify `main`, tags,
remotes, or publish anything; online synchronization is not asserted as a
condition that this local branch has already satisfied.

The pre-W6 pass only inspected release inputs, repository state, test commands,
and package provenance. It did not bump a version, run the writing form of
`build-version`, build/stage/commit/push, publish, modify `main` or tags, or
read A2A state contents. Its only write was that earlier evidence snapshot;
the W6 writes are recorded in the current checkpoint above.

## Historical inventory (pre-W6; retained for provenance)

## Repository and mirror state

```text
branch:   agent/wf-ui-state-checkpoint-20260804
HEAD:     0212e161079aa554b2a3b070d0503fa6260b7fd0
upstream: origin/agent/wf-ui-state-checkpoint-20260804
HEAD...upstream: 2 ahead, 0 behind
```

Configured remotes:

```text
origin  https://github.com/LiWeny16/create-harness-vibe-coding.git
legacy  https://github.com/zingspark/create-harness-vibe-coding.git
```

Local remote-tracking refs at inspection time:

```text
origin/main                                  5cff3c61cdea0a8b4d01c572dece620b63b427b9
legacy/main                                  a81699b7c6bba4ad1ea85742785e33882c6807bf
origin/agent/wf-ui-state-checkpoint-20260804 5cff3c61cdea0a8b4d01c572dece620b63b427b9
local v0.9.* tags                            none
```

The online default branches are stale and the release tags are absent:

```text
canonical LiWeny16 main .harness-version: HTTP 200, generator 0.8.20
legacy zingspark main .harness-version:    HTTP 200, generator 0.8.19
canonical v0.9.1 manifest:                 HTTP 404
legacy v0.9.1 manifest:                    HTTP 404
canonical v0.9.2 manifest:                 HTTP 404
legacy v0.9.2 manifest:                    HTTP 404
git ls-remote refs/tags/v0.9.1,v0.9.2:    no refs on either remote
```

At the pre-W6 inspection the local package was `0.9.1`; W6 now records the
candidate as `0.9.2` above. There is no tracked lockfile to bump:
`package-lock.json` and `pnpm-lock.yaml` exist only as ignored local files;
`npm pack` does not use them as published files.

## Exact 0.9.2 synchronization set

The release owner must review and then synchronize these exact version-bearing
files in an isolated clean candidate:

1. `package.json`: set `version` to `0.9.2`.
2. `CHANGELOG.md`: add the dated `## [0.9.2]` entry before the existing
   releases. `build-version.mjs` copies up to eight `- ` highlights from this
   entry into the manifest.
3. Run `node scripts/build-version.mjs` only after the candidate source and
   template files are final. Its write outputs are exactly:
   `templates/common/.harness-version`,
   `templates/common/Harness/ownership.manifest.json`,
   `Harness/.harness-version`, and `Harness/ownership.manifest.json`.
   The root version file preserves project-local options/state while refreshing
   generated identity/checksums.
4. Verify with `node scripts/build-version.mjs --check` and
   `node scripts/check-root-harness-version.mjs`.

`scripts/build-version.mjs` derives the template manifest from
`templates/common/` plus `templates/optional/catalog.json`, maps the generated
source to canonical `LiWeny16`, and does not derive it from task/evidence
files. `npm version` is not a project script; if used by the owner,
`npm version 0.9.2 --no-git-tag-version` must be followed by inspection of
ignored local lockfile changes before any selective stage.

## Candidate stage paths (selective; never `git add .`)

The dirty worktree had 283 status paths. The following are the candidate
framework/package/test paths observed and should be staged only after owner
review. The grouped braces are explicit path sets, not permission to include
unlisted files.

Release metadata:

```text
CHANGELOG.md
README.md
README-CN.md
package.json
```

Production source:

```text
Harness/a2a/action-registry.json
src/generator.js
src/index.js
src/prompts.js
src/ui/src/components/Header.tsx
src/ui/src/components/TaskList.tsx
src/ui/src/components/WorkflowRoute.tsx
src/ui/src/components/WorkflowSkillsHubOverlay.tsx
src/ui/src/i18n/translations.ts
src/ui/src/types.ts
src/wf-ui-server/a2a-store.mjs
src/wf-ui-server/dispatch-contract.mjs
src/wf-ui-server/harness-env.mjs
src/wf-ui-server/model-capability.mjs
src/wf-ui-server/peer-capsule.mjs
src/wf-ui-server/pty-adapter.mjs
src/wf-ui-server/runtime-detector.mjs
src/wf-ui-server/server.mjs
src/wf-ui-server/session-registry.mjs
src/wf-ui-server/settings.mjs
src/wf-ui-server/task-parser.mjs
```

Runtime/release tests and their committed fixture sources:

```text
src/wf-ui-server/__tests__/action-registry-loader.test.mjs
src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs
src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs
src/wf-ui-server/__tests__/runtime-review.test.mjs
src/wf-ui-server/__tests__/server.integration.test.mjs
src/wf-ui-server/__tests__/task-parser.test.mjs
src/wf-ui-server/__tests__/workflow-action-registry.test.mjs
tests/cli-smoke.test.js
tests/generator.test.js
tests/harness-intelligence-bench.test.js
tests/harness-intelligence-bench-review.test.js
tests/harness-intelligence-boundaries.test.js
tests/harness-intelligence-install.test.js
tests/harness-intelligence-policy.test.js
tests/memory-context.test.js
tests/pack-smoke.test.js
tests/research-policy.test.js
tests/review-cross-contract-092.test.js
tests/review-effort-server-092.test.js
tests/runtime-dispatch-cli.test.js
tests/runtime-review-backend.test.js
tests/task-context.test.js
tests/task-state.test.js
tests/verify-context-memory-092.test.js
tests/verify-runtime-release-cli-project.test.js
tests/verify-runtime-release-png-only.test.js
tests/wf-backend-ensure.test.js
tests/wf-learn-contract.test.js
tests/wf-update-runner.test.js
tests/fixtures/runtime-092/codex
tests/fixtures/runtime-092/codex.cmd
tests/fixtures/runtime-092/pty-adapter.mjs
tests/fixtures/harness-092/**
tests/fixtures/harness-intelligence-install/**
```

Benchmark evaluator source is also candidate repository source (but is not
part of the npm package):

```text
benchmarks/harness-intelligence-092/{README.md,manifest.json,report.schema.json,evidence-template.md}
benchmarks/harness-intelligence-092/b1/sentinel.txt
benchmarks/harness-intelligence-092/b2/{baseline-handoff.md,data.json,handoff.md,stage1-user-prompt.md,stage2-user-prompt.md}
benchmarks/harness-intelligence-092/{b3,b4,b5,b6}/user-prompt.md
```

Exclude only benchmark raw run results and heldout/private evidence (for
example `runs/**`, `results/**`, `holdout/**`, and `private/**`); do not
exclude the static manifest, schema, prompts, or evidence template from a
clean repository checkout.

The fixture globs above are limited to static test fixtures under `tests/`;
they are not user task state and `npm pack` must exclude all `tests/` paths.

Template source set:

```text
templates/common/.harness-version
templates/common/README.md
templates/common/CLAUDE.md
templates/common/.claude/agents/review-manager.md
templates/common/.claude/commands/{wf.md,wf-help.md,wf-learn.md,wf-max.md,wf-review.md,wf-task-archive.md,wf-task-list.md,wf-task-record.md,wf-update.md}
templates/common/.claude/skills/{wf/SKILL.md,wf-learn/SKILL.md,wf-max/SKILL.md,wf-review/SKILL.md,wf-update/SKILL.md}
templates/common/.opencode/agents/review-manager.md
templates/common/.opencode/commands/{wf.md,wf-help.md,wf-learn.md,wf-max.md,wf-review.md,wf-task-archive.md,wf-task-list.md,wf-task-record.md,wf-update.md}
templates/common/Harness/CLAUDE.md (not present; use templates/common/CLAUDE.md)
templates/common/Harness/{MEMORY.md,README.md,ownership.manifest.json}
templates/common/Harness/a2a/{action-registry.json,workflows.json}
templates/common/Harness/project/architecture.md
templates/common/Harness/research/README.md
templates/common/Harness/scripts/{README.md,memory-context.mjs,research-policy.mjs,task-context.mjs,task-group-index.mjs,task-state.mjs,validate-harness.mjs,wf-ui-control.mjs,wf-update-check.mjs,wf-update-runner.mjs}
templates/common/Harness/scripts/lib/{memory-context.mjs,path-scope.mjs,research-policy.mjs}
templates/common/Harness/specs/guides/SETUP.md
templates/common/Harness/specs/protocols/{MEMORY_PROTOCOL.md,TASK_ARCHIVE.md}
templates/common/Harness/specs/runtime/{context-loading.md,dispatch.md,subagents.md}
templates/common/Harness/specs/workflows/{WF.md,WF-AUTO.md,WF-AUTO-SPARK.md,WF-KERNEL.md,WF-MAX.md,WF-STATE.md}
templates/common/Harness/tasks/_template/{PLAN.md,PROGRESS.md,STATE.json}
templates/common/Harness/tasks/{INDEX.json,INDEX.md}
```

The `templates/common/Harness/CLAUDE.md` line is an explicit absence check,
not a stage path. The actual template path is `templates/common/CLAUDE.md`.
The package source also contains `scripts/harness-intelligence-bench.mjs`
as a repository test/scorer utility; it is not in `package.json.files` and is
not part of the generated install payload.

Dogfood mirror files require a separate byte/parity decision. Do not stage
them from this dirty project blindly: root `Harness/scripts/**`,
`Harness/specs/**`, `.agents/**`, `.claude/**`, and `.opencode/**` are local
runtime/project surfaces. If the release owner elects to include generated
dogfood mirrors, regenerate/compare them from the template source first and
stage only the exact matching files. Root `Harness/.harness-version` and
`Harness/ownership.manifest.json` are generated outputs listed above.

## Protected and excluded paths

These observed paths must not enter the release stage in this pass:

```text
3080.md
3080-xianyu-cover.png
Harness/tasks/**                  # root active/archive/evidence/user state only
                                   # (template source is templates/common/Harness/tasks/_template/**)
Harness/a2a/**                    # root workflow/node runtime state only
                                   # (Harness/a2a/action-registry.json is reviewed source)
Harness/scripts/debug-memory-fixture2/**
benchmarks/harness-intelligence-092/{runs/**,results/**,holdout/**,private/**}  # raw/heldout/private evidence only
Harness/wf-browser/**
Harness/.temp/**
Harness/.runtime/**
*.png, *.jpg, *.jpeg, *.webp      # run screenshots/visual artifacts
tmp/**, temp/**, node_modules/**
```

The current task capsule, all `evidence/*.md|json|mjs`, root task `STATE.json`,
archive state, and root A2A node files are release evidence/state, not package
source. The static root `Harness/a2a/action-registry.json` is an explicitly
reviewed framework source exception; no A2A state contents were inspected.
Ignored `package-lock.json` and
`pnpm-lock.yaml` are also excluded from stage.

## Test and gate order

The repository-defined CI/pre-push order is:

```text
1. node scripts/build-version.mjs --check
2. node templates/common/Harness/scripts/validate-harness.mjs --strict
3. npm install                 # CI dependency setup
4. npm test                    # must collect final exit code
5. npm run test:e2e
6. npm run pack:smoke
```

The local pre-push script adds, before the test gates,
`node scripts/check-root-harness-version.mjs`,
`node --check scripts/check-update-mirrors.mjs`,
`node scripts/check-script-mirrors.mjs`, and both dogfood/template strict
validators; it wraps `npm test` in `node scripts/check-temp-leak.mjs --`.
After a release is actually published/synced, `npm run check:mirrors` checks
canonical/legacy main and tag manifests. It must not be treated as green
against the currently stale online mirrors.

Additional runtime matrix required because `npm test` only runs
`tests/*.test.js`:

```text
node --test src/wf-ui-server/__tests__/runtime-review.test.mjs src/wf-ui-server/__tests__/dispatch-lifecycle.test.mjs src/wf-ui-server/__tests__/runtime-detector.test.mjs src/wf-ui-server/__tests__/runtime-config.test.mjs src/wf-ui-server/__tests__/peer-capsule.test.mjs src/wf-ui-server/__tests__/workflow-agent-messages-structured.test.mjs tests/runtime-review-backend.test.js tests/wf-backend-ensure.test.js tests/runtime-dispatch-cli.test.js tests/verify-runtime-release-png-only.test.js tests/verify-runtime-release-cli-project.test.js
node --test src/wf-ui-server/__tests__/codex-appserver.test.mjs src/wf-ui-server/__tests__/claude-stream-json.test.mjs src/wf-ui-server/__tests__/opencode-server.test.mjs src/wf-ui-server/__tests__/pty-adapter.test.mjs src/wf-ui-server/__tests__/security.test.mjs
node --test src/wf-ui-server/__tests__/effort-compatibility-red-092.test.mjs tests/review-effort-server-092.test.js tests/review-cross-contract-092.test.js
node scripts/harness-intelligence-bench.mjs --self-check
```

The independent readiness reports recorded 74/74 and 51/51 for the first two
runtime groups, and the effort server/identity matrix is 5/5 with the current
source. Re-run all groups in the clean candidate after the remaining release
inputs are resolved; no current task evidence file may be required as runtime
input.

## Historical observed command results (pre-W6)

`npm test` was run to termination, not stopped at the tool call limit:

```text
exit 1
tests 378
pass 375
fail 2
skipped 1
duration 44.478s
```

Failures:

1. `tests/context-budget.test.js`: `cache-diagnostics-route` is 36,935 bytes
   against a 36,000-byte budget. This is a real content-budget failure, not a
   version-only failure.
2. `tests/harness-intelligence-install.test.js:121`: current package version
   is `0.9.1`, while the test expects the approved candidate `0.9.2`.

The local pre-release report also records both strict validators failing on
existing task-state warnings (missing `task-make-wf-lifecycle-0908/STATE.json`
and outer-task-cap warnings). Do not mutate/archive task state to make a
release gate green; validate from the clean exact-SHA candidate without user
task/A2A state.

## Historical current-task/evidence dependency scan (superseded)

The following source/tests were checked for direct dependency on the current
uncommitted task/evidence tree:

- The pre-W6 version of `tests/verify-context-memory-092.test.js:37-38`
  invoked `task-context.mjs pack task-upgrade-harness-092 --project repoRoot`.
  This was the portability defect. W6 replaced it with a self-contained
  `task-context-fixture` copied into `makeHarnessTempRoot()`; the current
  49/49 matrix and `verify-release-portability-budget-092.md` supersede this
  finding.
- `tests/harness-intelligence-install.test.js:119` only asserts that a task
  path is absent from `npm pack`; it does not read the task capsule.
- `src/wf-ui-server/__tests__/runtime-review.test.mjs` and
  `tests/review-effort-server-092.test.js` use their task IDs under
  `makeHarnessTempRoot()` and do not read the current task/evidence tree.
- Runtime/benchmark code accepts explicit isolated `evidenceRoot` or fixture
  paths; no source path under `Harness/tasks/task-upgrade-harness-092/evidence`
  was found as required runtime input in the scanned package/test paths.

## Historical transport capability boundary (superseded)

`src/wf-ui-server/dispatch-contract.mjs:10,65-75` declares both `pty` and
`chat` as accepted dispatch transports. `server.mjs:4932` maps `chat` to
`uiMode: 'chat'`, and `spawnChatRuntimeSession()` is reached.

For chat, the model, effort, and trusted variant are now passed through the
structured driver path:

- `server.mjs:5555-5564` calls `resolveRuntimeLaunchArgs(runtime, { model,
  effort, effortVariant, launchPolicy })` and `:5617-5618` passes both fields
  to the structured driver on initial and retry creation.
- Claude stream-json carries `--effort <value>` in its actual child argv.
- Codex app-server carries `effort` in each documented `turn/start` request
  and model/effort in its `--config` argv; `turn/steer` has no effort field and
  inherits the active turn.
- OpenCode carries the exact model and trusted model-level `variant` in both
  `/session/:id/prompt_async` and `/message` request bodies. Its serve argv
  strips only generic `--model`/`--variant` pairs because the installed
  `opencode serve` rejects those options.

The independent structured-chat verifier covers the real HTTP dispatch path
and all three native adapters. Its four test bodies pass. The earlier Windows
`afterEach` cleanup EPERM was superseded by the independent GREEN teardown
verification recorded in the newer chat evidence; it is not a current
candidate blocker.

Conclusion: strict dispatch supports both declared transports. PTY uses native
launch argv; chat uses the structured native driver wire described above. The
wire evidence proves exact parameter handoff, not provider account access or
task success.

## Historical isolated exact-SHA release/provenance procedure

After the release owner resolves the two `npm test` failures and the
current-task test dependency:

1. Create a fresh detached worktree/clone at the exact candidate commit SHA;
   do not carry `Harness/tasks/**`, `Harness/a2a/**`, screenshots, temp roots,
   ignored locks, or user settings into it.
2. Confirm `git rev-parse HEAD`, package `version`, and the four generated
   manifest paths. Run `npm install` exactly as CI does; record Node/npm
   versions and the install command.
3. Run the version/checksum and strict validator gates, then the complete
   `npm test` and record its final exit code/output summary. Run the explicit
   runtime matrix, `npm run test:e2e`, and `npm run pack:smoke` in that order.
4. Run `npm pack --dry-run --json` and mechanically assert the package version
   is `0.9.2`, `Harness/tasks/**`, `Harness/a2a/**`, `tests/**`, benchmark
   assets, screenshots, and task evidence are absent, while the required
   `src/`, `templates/`, `bin/`, README-CN, CHANGELOG, and UI dist payloads
   are present. Save the JSON only outside the repository if an artifact is
   needed; do not add it to the package.
5. For install provenance, run `npm pack` in the isolated worktree, compute
   the tarball SHA-256, install that exact tarball into a second clean temp
   directory, run the installed CLI `--help` and a dry-run/init smoke, and
   compare the installed package version plus generated manifest generator,
   source, and checksums to the exact source SHA. No provider inference or
   `npm publish` is needed.
6. Only after canonical and legacy remotes expose the same commit, `v0.9.2`
   tag, generated manifests, and GitHub Release artifacts should the owner run
   `npm run check:mirrors`. The online state observed above is currently
   `0.8.20`/`0.8.19` main and no release tag, so release is not ready.

## Historical verdict (pre-W6)

**Not release-ready in the current worktree.** The runtime implementation
checks and structured chat effort handoff are green (the independent chat
verifier has a Windows temporary-root teardown EPERM), but version/checksum
generation is intentionally pending, `npm test` has two real failures, one
test reads the uncommitted task capsule, strict local validation sees
protected task state, and both online mirrors are old with no `v0.9.2` tag.
The root controller must make the remaining decisions and perform any future
version/build/stage/commit/push actions from a clean exact-SHA candidate.

## Current W6 interpretation

The local `0.9.2` candidate metadata, generated manifests, UI build, unit/e2e/
pack gates, benchmark self-check, and explicit runtime matrices are green.
Strict validators retain only the documented pre-existing task-state warnings.
This is not a publish or release-complete claim: the remaining intelligence
goals, fresh-provider/real-world coverage, and real post-release benchmark are
still pending. Parent review must select only proven source paths, account for
the tracked user/runtime state noted above, and create any future clean exact-
SHA installation outside this dirty worktree. No stage, commit, push, remote
mirror update, tag, or npm publish was performed here.
