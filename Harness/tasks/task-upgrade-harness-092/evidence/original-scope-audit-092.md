# Original-scope audit and risk reflector (092)

Date: 2026-09-09. Reviewer: independent Luna xhigh release-readiness lane.

## Scope and verdict

This is a bounded read-only audit of the frozen `PLAN.md`, `PROBLEM.md`,
`REFERENCES.md`, `CONTRACTS.md`, `BENCHMARK.md`, existing evidence, and the
implementation surfaces named by those records. It does not re-run external
research and it did not modify source, canonical task state, version, Git,
memory, or A2A state. The only intended write is this evidence file.

The project has substantial implementation and fixture evidence, but it is not
an accepted 0.9.2 release. Structural coverage, local tests, and benchmark
preparation are repeatedly being recorded as pending acceptance in the frozen
documents. The hard release blockers are the missing exact-SHA/fresh-install
lane (AC-08/AC-09), the absent real post-release benchmark/holdout (AC-07/09),
and incomplete independent source/reuse and state-freshness evidence (AC-01/02).
The B3 scorer compatibility finding is now independently resolved against the
frozen one-retry/new-session contract; real cross-runtime benchmark evidence
is still absent. The current B3 scorer owner is `fix_dispatch_cli_092`; the
three-runtime effort forwarding plus OpenCode variants and trusted Claude
config repair is owned by `fix_runtime_review_092`. This audit records
ownership, not acceptance.

## AC-01..AC-09 gap matrix

| AC | Current implementation and evidence | Still missing or design-only | Gate assessment |
|---|---|---|---|
| AC-01 command/source audit, reuse ledger, SOTA boundaries | `Harness/specs/runtime/command-surface.json` is a 17-row registry; `tests/generator.test.js` 38/38 and `verify-integration-092.md` report all command/skill/template mirrors. `REFERENCES.md` and `Harness/project/architecture.md` record the seven reuse candidates and explicitly prohibit copied-code/SOTA claims. | The registry proves surfaces, not behavior for every command/runtime. The ledger has URLs and decisions but no complete current source version/date/license/terms/counterexample/recheck record; this audit adds a bounded primary-source record below. `CONTRACTS.md` names three normative sources while `REFERENCES.md` carries seven candidates; that difference alone is not a conflict because applicability rules do not contradict. | **HARD pending.** Do not close AC-01 or call any source “verified” beyond the specific primary-source facts recorded below. |
| AC-02 durable intent/context/state/recovery | `task-context.mjs` implements update/show/pack, immutable-intent and scoped entries; context/memory integration evidence reports 22 core, 7 boundary, and 3/3 independent context regression tests passing, plus a real pack whose canonical STATE hash did not change. `task-state.mjs` supplies query/validate/reconcile/transition and legacy reads. | The initial audit found `STATE.json` stale; the current task-scribe checkpoint now refreshes `updatedAt`, `nextAction`, `intent.current`, handoff, queues, workItems, and evidence pointers while preserving original/history. The tools remain explicit writers, not an automatic event-to-task-state synchronizer. No clean close/interruption/recovery exercise proves timely updates across all fields. | **HARD freshness/recovery gap.** Content tools exist, but “context is automatically correct” is not evidenced; the current checkpoint is bookkeeping, not AC acceptance. |
| AC-03 bounded role/task pack dispatched and consumed/recovered | Pack fields, UTF-8 byte budget, role/work-item filtering, evidence pointers, and dispatch CLI consumption are implemented. `tests/harness-intelligence-*`, `tests/runtime-dispatch-cli.test.js`, and installed-script checks cover local behavior; current project/CWD CLI regression is 2/2. | A real fresh candidate worker/recovery trace, duplicate-context metric, and missing/over-budget recovery decision are not recorded. Existing pack tests are not proof that the parent workflow always generated and consumed the pack at every dispatch. | Pending for full AC; no standalone release claim until AC-09 fresh run. |
| AC-04 scoped memory and `wf-learn` | `wf-learn` routes `query`, `validate`, `apply`, and `feedback`; memory entries have scope, evidence, counterexample, status, supersede/disable links, and retrieval feedback. Boundary and policy tests pass; the skill requires Probe -> Identify -> Act -> Verify and separates instance facts from methods. | “Compact/match/retire” is implemented as bounded query/top-k/byte filtering and explicit status/supersede operations, not a measured automatic quality loop. No independent fresh task proves a method survives counterexample, conflict, supersede/disable, retrieval feedback, and later re-query end-to-end. B4 remains fixture/prep evidence; prior review also found whole-file byte equality unsuitable for append-only audit history. | Contract evidence incomplete; benchmark B4 is blocked pending independent scorer/manual semantic review. |
| AC-05 explicit cross-runtime/model/capability/A2A/PTY lifecycle | Runtime server has explicit runtime/model/effort/transport dispatch fields, capability probes, auth-bound worker reports, idempotency/replay, cancellation, and one-retry/new-session behavior. Existing runtime matrix/evidence reports focused auth and driver suites green; exact Codex `gpt-5.6-luna` read-only probe succeeded without inference and unknown Codex model did not silently fall back. The independent B3 legal-trace review now passes the repaired scorer. The owned effort review proves missing metadata fails closed, exact `opencode/gpt-5.6-luna` with native/test-authoritative `xhigh` metadata succeeds, and unsupported effort is rejected. | No real paid-provider cross-runtime B3 run is recorded. Native OpenCode 1.18.4 verbose discovery currently reports both exact Luna provider/model entries with an `xhigh` variant; this is catalog evidence, not inference or paid execution. Claude’s string-only `availableModels` cannot satisfy mandatory effort verification without trusted metadata. The `fix_runtime_review_092` lane owns the three-runtime server effort-forwarding/settings repairs, while `fix_dispatch_cli_092` owns HTTP requested/effective preservation. Typed `agent.start/createNode` remain legacy graph/session APIs, not proof of universal typed dispatch creation. | **HARD for cross-runtime benchmark.** Legal trace/scorer and local capability gates are green; real cross-runtime/strict-Claude acceptance is not. |
| AC-06 browser-free backend plus same-task UI attach | `ensure-backend --project ... --no-open` is covered by `tests/wf-backend-ensure.test.js` 3/3 (cold start, reuse, project isolation). CLI project-root/CWD test is 2/2. Existing bounded browser evidence shows a real project-scoped server and task inspector, with `openBrowser:false` for backend start. | The inspector PNG and task are a development-candidate UI observation, not a post-release fresh-install B6 run. A fresh installed candidate must prove CLI-only backend start, then UI reads the same canonical task/index with provenance. | Pre-release implementation evidence is useful; AC-06 acceptance remains pending the installed-candidate lane. |
| AC-07 independent behavior/CLI/API/browser evidence and measured metrics | Independent runtime, backend, context, CLI, PNG-oracle, and browser evidence files exist; `BENCHMARK.md` requires estimated versus provider-measured fields, and provider token/cost may validly be recorded as `unknown` when unavailable. No credential is emitted. | Same-model/no-Harness baseline, real post-release CLI/API/browser run, n-per-category result, and independent fresh scorer/holdout report are absent. A unit/fixture pass cannot establish world-leading performance. Missing provider telemetry by itself is not a hard failure; the hard distinction is to record unknown rather than fabricate a measured value, and to separate estimate from provider-measured data when available. | **HARD pending real benchmark evidence.** Metrics and an independent run are required before any effectiveness claim; telemetry unavailability alone does not add a gate. |
| AC-08 0.9.2 build/test/pack/mirror/push, no npm publish | Local package smoke, anti-drift, validator, and mirror-byte checks exist. Current local root/template `wf-ui-control.mjs` bytes are equal; `npm run check:mirrors` was separately recorded as online stale/404. No npm publish was attempted. | Package is still 0.9.1; version manifest is stale, remote v0.9.1 URLs are 404/older remote metadata, and no exact 0.9.2 candidate SHA has been pushed. Dirty-tree pack cannot be identified with a future SHA merely by matching a version string. | **HARD release blocker.** Parent approval, selective staging, 0.9.2 build, push, remote SHA, and archive provenance are absent. |
| AC-09 exact-SHA fresh install, fresh Luna tasks, independent scoring, holdout, repair/rerun | Frozen benchmark defines B1-B6, immutable reporting, fresh-install provenance, independent scorer, and holdout rules. Existing fixture/self-check evidence is useful oracle preparation; B2 fixture fairness is green. The independent B3 scorer/trace and capability-gate reviews are green locally. | No exact pushed SHA fresh install, fresh `gpt-5.6-luna` execution, independent Luna scoring, sealed holdout result, or repair/rerun exists. Existing B3/B4/B6 results are prep/fixture evidence only; no post-release benchmark exists. | **HARD release blocker.** AC-09 is wholly pending. |

## All 17 WF command coverage

The registry contains exactly 17 commands. Every row currently declares
`claudeCommand`, `opencodeCommand`, `claudeSkill`, `codexSkill`, and `helpRow`
as present; the local existence check found the corresponding four files for
each row. This is surface/mirror coverage, not 17 independent behavioral
acceptance runs.

| Command | Registry class / capsule policy | Evidence boundary |
|---|---|---|
| `wf-help` | direct / none | Four-surface files exist; help-row/registry and policy checks pass; no independent help UX run. |
| `wf` | workflow / required | Four-surface mirror and bounded pack/research policy tests pass; no full live dispatch acceptance. |
| `wf-max` | workflow / required | Policy tests cover Useful no-spawn/Strict fan-out markers; model choice remains explicit, not an automatic cost router. |
| `wf-auto` | workflow / auto-capsule-required | Generator/policy markers pass; no real continuous auto-cycle or checkpoint trace. |
| `wf-auto-spark` | workflow / auto-capsule-required | Generator/policy markers pass; no real continuous spark/roadmap cycle. |
| `wf-review` | workflow / use-current-or-create-when-needed | Mirror/registry checks pass; no independent end-to-end review invocation. |
| `wf-learn` | workflow / use-current-or-create-when-needed | `tests/wf-learn-contract.test.js` and memory policy tests pass; semantic retrieval/retirement benchmark absent. |
| `wf-browser` | workflow / required | `verify-browser-092.md` records bounded real task-inspector observation; not installed-candidate B6. |
| `wf-readme` | workflow / required | Generator/mirror anti-drift checks pass; no independent docs-authoring workflow run. |
| `wf-update` | direct / none | `tests/anti-drift.test.js` and updater-runner tests pass; no pushed-SHA candidate update. |
| `wf-remove` | workflow / required | Registry/cleanup structural checks pass; no full destructive-flow acceptance in this lane. |
| `wf-task-record` | direct / creates-or-updates | Task-state tests cover record/update paths; stale-checkpoint risk remains. |
| `wf-task-list` | direct / none | Task-state list/query and direct-command exemption checks pass; no multi-runtime E2E. |
| `wf-task-archive` | direct / none | Archive routing is documented/tested; old user tasks remain outside this task's write set. |
| `wf-command-create` | direct / required | Wrapper/registry checks pass; no independent generated-command lifecycle run. |
| `wf-ui` | direct / none | CLI smoke, server bridge, and no-open backend checks pass; no installed-release run. |
| `wf-init` | direct / none | `tests/generator.test.js` 38/38 and mirror checks pass; no release-candidate fresh-install acceptance. |

`tests/generator.test.js` 38/38 and the existing integration report therefore
support “all 17 surfaces exist and are mirrored”; they do not support “all 17
commands work end-to-end across all runtimes”.

## Original research/reuse scope: what exists locally

The following seven records are present as URL/reference entries in
`REFERENCES.md` and the architecture notes. No code from these sources is
vendored or imported by the implementation inspected here.

| Source | What is actually present | Release interpretation |
|---|---|---|
| Anthropic, *Building effective agents* | Cited prose URL and an adapt-only decision. | Reference string exists; no current primary-source fetch/version/date artifact in this task evidence. |
| Anthropic, *Effective context engineering* | Cited prose URL and bounded-pack adaptation. | Same: concept is implemented locally, provider cache improvement is not proven. |
| Anthropic, *Effective harnesses for long-running agents* | Cited prose URL and resumable-handoff adaptation. | Same: local STATE/A2A is an adaptation, not equivalence evidence. |
| OpenAI, *Harness engineering* | Cited prose URL and process-only adaptation. | It is not in frozen `CONTRACTS.md`’s shorter normative subset; that is a scope distinction, not a conflict. No SOTA/equivalence claim is allowed. |
| GitHub `deepseek-ai/DeepSeek-Harness` | Cited repository URL; local DeepSeek-named A2A components are user/project artifacts, not proof of official source reuse. | Primary snapshot/license facts are recorded below; no code was copied or vendored. |
| Hugging Face `smolagents` agents reference | Cited docs URL; Apache-2.0 and version are reported/“verify version”; only bounded concepts are proposed, Python dependency rejected. | No dependency or implementation reuse found; no version/license proof in this task evidence. |
| Hugging Face `ScreenSuite` | Cited blog URL; benchmark/terms explicitly marked “verify”. | Evaluation framing only; no scores or SOTA claim. |

Thus “source exists” means a local ledger entry and URL exist; the bounded
record below separately states which official page date, repository snapshot,
or license was actually observed. `CONTRACTS.md`’s three-source normative
subset and `REFERENCES.md`’s seven-source research ledger are not inconsistent
unless their applicability rules conflict; no such conflict was found here.
No source code was copied or vendored. The no-rescan boundary remains
intentional: only the seven named sources and three Claude Code docs were
rechecked, not a general web survey.

## Original questions and implementation reality

### Decomposition and strong/cheap routing

Task decomposition, dependencies, role packs, read/write sets, and a dynamic
ready queue are documented in `WF.md`, `WF-KERNEL.md`, `WF-STATE.md`, and
`subagents.md`. The model matrix labels scoped/chore roles “small-fast” and
decision/implementation roles “standard”; WF-MAX Useful allows a recorded
no-spawn decision and says to use strong controller/manager plus cheap scoped
roles when fan-out is useful.

This is orchestration guidance and explicit controller choice, not an automatic
economic router. The current task pins workers to `gpt-5.6-luna`/`xhigh`.
`dispatch-contract.mjs` requires explicit `runtime`, `model`, `effort`, and
`transport`; `wf-ui-control.mjs create-agent` forwards those explicit flags.
No source path inspected selects a cheaper model from task risk/cost, measures
provider cost, or automatically promotes a worker to a stronger model.
`defaultAgentRuntime` is runtime selection, not model economics. Typed
`agent.start`/graph actions remain legacy session controls. Automatic strong/
cheap routing is therefore a future capability, not a shipped claim.

### `wf-learn` compact/match/retire behavior

The implementation does bounded query by scope/top-k/byte budget, filters
inapplicable or stale/superseded/disabled entries, validates evidence plus a
counterexample before method apply, and records retrieval feedback. “Retire”
is an explicit status/supersede/disable action, not an unobserved autonomous
quality judgment. There is no measured retrieval precision/recall or fresh
end-to-end learning benchmark. Instance-specific model/path/port facts are
correctly required to remain task evidence by the skill contract.

### CLI without UI

The backend path is genuinely available without opening a browser:
`ensure-backend --project <root> --no-open --json` has 3/3 cold-start/reuse/
isolation evidence, and the current create-agent project/CWD regression is
2/2 with server root, worker `cwd`, and relative context pack anchored to the
target project. This proves a local CLI/API path; it is not a provider
benchmark and does not prove the installed 0.9.2 artifact.

### A2A boundary

The inspected server canonicalizes one project root; A2A graph/default stores
are under `<project>/Harness/a2a`, peer capsules under
`<project>/Harness/tasks/<task>/peers`, and task/peer IDs reject traversal.
Context/runtime boundary tests reject outside-project task/context inputs, and
backend tests cover project isolation (a symlink alias is treated as the same
physical project where supported). `peer-capsule.mjs` explicitly keeps task
STATE owned by `task-state.mjs`. This establishes a project-local file/control
boundary only. It does not establish internet A2A, AgentCard, or
standards-level interoperability; the benchmark text correctly limits the
claim to local A2A/peer-capsule envelopes.

### “World-leading” claim

No same-model/no-Harness baseline, statistically meaningful n, sealed holdout,
or post-release independent score exists. Provider token/cost is permitted to
remain `unknown` when the provider does not expose it; no estimate may be
reported as provider-measured. A
fixture pass, 7/7 unit suite, or one smoke run cannot establish world-leading
quality, speed, cost, recovery, or causal Harness benefit. The frozen
benchmark explicitly forbids a SOTA claim; retain that boundary.

## State freshness: tool existence versus automatic correctness

`task-context.mjs` writes only when called as `update --apply`; `show` and
`pack` read. `task-state.mjs transition/reconcile` are also explicit commands.
The runtime does persist session/peer state and `rememberTaskRuntime` may record
runtime metadata, but the inspected dispatch/peer paths do not automatically
maintain the parent task’s `nextAction`, `context.handoff`, queue membership,
work-item status, or evidence pointers. `peer-capsule.mjs:157-159` states that
task STATE is owned by `task-state.mjs` and is never modified there.

The current canonical record is consequently a release-readiness risk: its
`updatedAt` is `2026-09-09T03:36:58.866Z`, `nextAction` still says context/
runtime verification and B3/B4/B6 fixture work are pending, queues still list
`W3-RUNTIME`, `W3-VERIFY-CONTEXT-MEMORY`, and `W3-REVIEW-RUNTIME` as running,
and `context.handoff.unresolved` still contains the old four runtime REDs and
three context REDs. Later evidence reports those lanes partly repaired and
adds the B3 retry/scorer finding. This is not evidence that the implementation
is wrong; it is evidence that the durable checkpoint is behind the evidence.

Minimum fields for one accurate scribe checkpoint (without adding a new
system) are:

1. `observedAt`, phase/gate, branch/HEAD/version, and dirty-tree/protected-file
   boundary (no broad staging implied).
2. One authoritative AC-01..AC-09 status map with each status, evidence path,
   command/result timestamp, and unresolved blocker.
3. `queues` plus each changed `workItems[]` owner, dependency, status, and
   evidence/dispatch ID; remove stale “running” claims only from verified
   returns.
4. Exactly one current `nextAction`, immutable `intent.original`, updated
   `intent.current`, handoff summary/unresolved list, and new evidence IDs.
5. Current attempts/outcomes and explicit release/benchmark facts: candidate
   SHA (or absent), package version, archive/fresh-install status, holdout
   status, scorer repair status, and parent approval status.

The scribe should derive these fields from the latest independent evidence and
parent decisions, then update the canonical capsule once. Workers should not
silently rewrite task state, and an unchanged old checkpoint must not be used
as proof of current acceptance.

## Release-before / release-after / future split

### Before any candidate push

- Parent must reconcile the stale checkpoint and keep every AC pending until
  the cited evidence is current.
- Complete primary-source/version/license/terms verification for the seven
  reuse records or leave them explicitly unverified; do not copy code or claim
  SOTA. The bounded recheck is recorded in `REFERENCES.md`; later updates use
  each source's listed recheck trigger.
- Close independent runtime/context review, including the B3 scorer repair
  and a real trace matching the frozen one-retry/new-session contract.
- Preserve `OpenCode`/`Claude` missing-effort behavior as `UNVERIFIED`; never
  invent an effort or silently replace `gpt-5.6-luna` with another model.

### After a pushed candidate (required real benchmark)

- Build and pack only from the exact pushed SHA in a clean isolated checkout;
  record archive hash, package listing, environment, install log, installed
  hashes, and sentinel.
- Run fresh Luna B1-B6 with independent review, separate estimated versus
  provider-measured fields, same-model baseline where feasible, and sealed
  holdout. Record actual runtime/model/effort and unsupported-runtime outcomes.
- For B3, use the allowed trace: independent cancellation dispatch plus a
  separate failed dispatch with its single retry in a new session; require
  request/ACK/RESULT binding and one side effect. Do not force three attempts
  in one dispatch when `CONTRACTS.md` freezes at most one retry.
- For B6, retain PNG-only decoder/oracle boundaries and real browser
  provenance; the development task-inspector PNG is not a post-release score.
- If repair is required, record failure, bounded fix, rerun, and unchanged
  holdout threshold. Do not publish npm.

### Future direction only

Automatic cost/risk model routing, provider token/cost normalization across
Codex/Claude/OpenCode, standards-level remote A2A interoperability, measured
wf-learn retrieval quality, true JPEG/WebP decoding, and reproducible locked
UI builds are all plausible follow-ups. None is present as a 0.9.2 acceptance
fact and none should be smuggled in by weakening the frozen contracts.

## Scribe checkpoint pack compaction

Using the existing read-only command
`node Harness/scripts/task-context.mjs pack task-upgrade-harness-092 --project
<repo> --role verifier --budget-bytes 8192 --json`:

- Before semantic compaction: `usedBytes=7564` of `8192`; mandatory sections
  and optional evidence pointers were retained with no omitted sections.
- After semantic compaction: `usedBytes=7332` of `8192`; no sections were
  omitted and the pack retained current intent, constraints, true unresolved
  questions, next action, facts, resolved provider-unknown limitation,
  decisions, attempts, E-14..E-21 pointers, and short handoff.

The reduction is only UTF-8 byte accounting; it is not a token/cost/provider
measurement. `intent.original` and existing history remain unchanged. All
AC-01..AC-09 statuses remain pending.

After the B3/native-effort checkpoint, the same absolute-project-root pack
command measured `usedBytes=7653` of `8192` with `omitted=[]`. The additional
native OpenCode and owned-effort facts remain within budget; this is still only
byte accounting, not a token or provider-cost measurement.

## Risk-reflector

| Risk lens | Reflection / containment |
|---|---|
| Omitted verification | The largest omission is treating fixture/self-check/structural mirrors as real post-release evidence. Explicitly missing: exact SHA, fresh install, fresh Luna, provider metrics, baseline, holdout, independent scorer, and B1/B5 provenance review. Keep a per-AC evidence pointer and timestamp. |
| Responsibility gaps | Parent is the sole final approver; workers own bounded implementation or evidence only. Current canonical queues still name old workers as running while later evidence is available. Scribe must reconcile returns; verifier/reviewer/scorer must remain independent of the implementer. |
| Compatibility | Legacy task fixtures, legacy `agent.start`/graph controls, OpenCode/Claude effort metadata, runtime aliases, and project/CWD resolution need explicit compatibility tests. Do not call the opt-in dispatch CLI proof that all typed APIs are dispatch-aware. |
| Rollback | No exact pushed SHA or archive exists to roll back to. A future release must retain the prior known SHA, candidate SHA, archive hash, generated-manifest diff, and a clean-checkout recovery recipe. Never use reset/clean/checkout to resolve the dirty tree. |
| Dirty staging | The worktree contains mixed framework edits, tests, generated UI/A2A/task artifacts, and user files. Use an allowlisted selective stage and `git diff --check`; exclude task state, A2A state, benchmark/holdout, and user assets unless parent explicitly includes them. A matching remote version is not provenance for a dirty pack. |
| Mirror/online state | Local root/template script bytes can be equal while the online mirror/version check is stale or 404. Report those as separate local-byte and online states; do not npm publish merely to turn the online check green. |
| Claim inflation | Do not turn source URLs into verified reuse, a local project A2A store into standards interoperability, a one-run UI screenshot into B6, or a fixture pass into world-leading performance. |

## Bottom line

The implementation has meaningful local green evidence, especially the 17
surface registry/mirrors, bounded context/memory tools, backend-without-UI
path, explicit capability gate, and project-root isolation. The release remains
**not ready**: AC-01, AC-02 freshness, AC-05 real cross-runtime, AC-07, AC-08,
and AC-09 have hard open evidence gates; AC-03/04/06 are only partially evidenced and still
depend on the exact-SHA fresh benchmark for acceptance. No npm publish, remote
push, state reconciliation, source edit, or benchmark claim was made by this
audit.
