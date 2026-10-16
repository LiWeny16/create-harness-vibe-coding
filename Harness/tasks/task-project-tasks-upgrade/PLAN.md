# task-project-tasks-upgrade - PLAN

## Mini PRD

### Goal

Make each generated Harness project the canonical source for project-level facts while retaining a separate, project-local Task execution system. Provide shared versioned schemas, CLI/API behavior, validation, bounded routing, safe legacy import, and long-term growth controls.

### User flow

- A single project can be managed from its own root; a workspace can register multiple project roots using a route-only index.
- The user reads a compact Project overview, then requests a domain section, a relevant Task, and only when needed its evidence/history.
- Project rollups are generated from Task state and labeled as generated; Project never manually duplicates Task status, next action, or evidence.
- A Task is physically archived using the existing dated `_archive/YYYY/MM/DD` mechanism and remains retrievable through history routes. A Project is marked archived and omitted from default project listings without moving its repository root.
- Legacy management documents are explicitly selected, previewed read-only, and only imported after an explicit confirmation; rollback is guarded by hashes.

### Scope

- Add Project and workspace-index schemas, project-local domain storage, a shared Project route/store library, `project-state.mjs` CLI, Project routes in the package API, and Project validation to generated template sources.
- Add bounded/sharded indexes and append-only, partitioned progress/history storage; enforce byte budgets and page large results.
- Add explicit-source dry-run/apply/rollback legacy import; preserve source, provenance, and unknown status.
- Add generator and generated-project tests for isolation, aggregation, routing, import safety, archive compatibility, and strict validation.

### Non-goals

- Do not replace Task capsules or Task status semantics.
- Do not physically move Project/repository roots.
- Do not auto-convert imported Plan bullets into Tasks, infer status, close Tasks, delete source data, or merge conflicts silently.
- Do not make changes only in root dogfood `Harness/`; package source and generated templates are required.
- No UI redesign or unrelated refactor.

## Approved release-scope extension

The user approved a method-neutral `wf-review` strategy change and asked to assess a 0.9.7 release. Add this release scope without rewriting the existing v0.9.6 tag/release:

- `wf-review` strategy: independent, risk-based first-pass reviewers; structured evidence-backed findings; targeted challenge of material, high-impact, or disputed findings; controller adjudication by repository evidence, not vote count; reviewer timeouts/unavailable coverage are not PASS. Do not require or forbid a particular CLI, runtime, model, or invocation method.
- Release preparation: evaluate and locally prepare package/Harness metadata for 0.9.7 only after code/test gates. Do not commit, push, create tags/releases, publish npm, or alter remote mirrors in this task without a separate explicit confirmation. A blocked gate means the release is not ready.

## Approved task auto-archive extension

The user approved a safe, default-on physical archive policy for verified closed tasks:

- Remove the arbitrary strict failure based on total outer capsule count; count alone never blocks validation or release.
- At SessionStart, automatically archive only capsules that pass the existing closeout verification and full safety eligibility checks. Keep `--dry-run` and `HARNESS_SAFE_AUTO_ARCHIVE=0` opt-outs. Explicit `--apply` may override the env opt-out; Stop remains dry-run.
- Never move active, blocked, current-focus, unverified, active-question, queued, owned/leased/locked capsules. Preserve atomic moves, idempotence, and live/archive route indexes.
- Keep structural/state integrity failures strict. Update docs and diagnostics to recommend the safe auto-archive path, not deprecated unfiltered `archive --apply`.
- Do not edit/delete archived capsule contents; only move eligible closed capsules through the existing safe archive transaction. Dry-run existing workspace first and apply only eligible results.

## Ownership and state contract

| Fact | Owner |
|---|---|
| Project ID/name, lifecycle status, project stage, goal, scope, milestones, overall plan, project risks, decisions, project-level deliveries/learning | `Harness/project/` |
| Task status, Task workflow phase, next action, dependencies, verification evidence, task history | `Harness/tasks/<id>/` and existing physical archive |
| Workspace project routing | Explicit workspace index; IDs and paths only, no project data or Task state |
| Project summary / task rollup | Derived at read time, marked `generated: true`, never hand-maintained |

Proposed v1 semantics: Project status `active|paused|completed|archived`; Project stage `discovery|planning|execution|maintenance|sunset`; Task canonical statuses remain `active|blocked|closed`. Project stage must not reuse Task `phase`. Existing Task `project`/`group` remains a legacy Task grouping label, not Project identity. Project membership is by owning project root; milestone-to-Task relationships are ID references in the Project plan.

## Storage and routing contract

- Each generated project owns `Harness/project/PROJECT.json`, charter, plan/milestone, risks, decision, progress, and evidence-reference indexes plus `Harness/tasks/`.
- `PROJECT.json` is a route entry only: `schemaVersion`, stable ID, name, lifecycle status, stage, and relative domain-index paths. It must stay <= 4 KiB. No Task list, history, full plan, logs, or unbounded notes. `charter.json` remains authoritative for charter facts; charter and Project revision changes use a staged, hash-checked idempotent journal, recovered before Project reads/writes.
- Long content is sharded: plan/milestone and risk/decision records are individual files; progress is append-only date-partitioned JSONL segments; each segment/index leaf is <= 8 KiB or 100 items. Section pagination applies cursor/limit to filename-derived IDs before reading selected record bodies, then stops as soon as the response byte budget is reached; `bytes` must equal the final serialized JSON length. Progress cursors are opaque/versioned and bind project+section+segment+in-segment ordinal so later pages do not reread earlier segments. Search has a finite per-request scan ceiling and a deterministic cursor ordered by section+record ID so duplicate IDs across sections are not skipped; it retains only bounded page results. Raw evidence remains referenced by path/URL and is loaded only on explicit request.
- Optional workspace `.harness-workspace/INDEX.json` contains only fixed routing roots and a hash-shard scheme. Per-Project route stubs live at `routes/{active|archived}/<sha256-prefix>/<project-id>.json` and contain only `{id, root, entry}`. Listing reads route filenames and only the requested page of route stubs; pages/output are <= 8 KiB with cursors. Project archive/restore moves only its route stub and updates `PROJECT.json` through a staged, hash-checked, idempotent journal; recovery runs before workspace reads/writes, and the project repository root does not move. Journals carry transaction metadata only and never replace canonical Project facts.
- Default route: workspace route page (only when requested) -> Project entry -> selected domain record/index -> selected Task route/capsule -> explicit evidence/history. Project entry <= 4 KiB; default summary/output <= 8 KiB; larger result sets require cursor/pagination. Task rollup reads only the authoritative Task INDEX under a finite byte ceiling, derives status counts at read time, and never opens Task capsules or stores duplicate Task facts in Project. Return `generated`, byte usage, truncation and continuation metadata.
- Plan/milestone and risk/decision/evidence indexes use fixed record roots and per-record hash-sharded files; project progress uses date-partitioned append-only segments capped at 8 KiB and is loaded only by explicit section/history requests. No long-lived single Project log/index is allowed.
- CLI: `project-state.mjs init|register|unregister|list|show|summary|search|update|archive|restore|validate|section|get|record|import|rollback`; local and workspace `list` both hide archived Projects by default and honor `--include-archived`, `--cursor`, `--limit`, and `--budget-bytes`. Section reads use `section <project-id> --section <name>` and return `items`, `nextCursor`, `truncated`, and `bytes`; `search` accepts the same `--cursor`, `--limit`, and `--budget-bytes` controls. `validate --root <project-root> --workspace <workspace-root>` reconciles an explicitly selected workspace. Existing `task-state.mjs` remains the Task CLI, including its physical archive commands; `--project` retains group-filter compatibility. `validate-harness.mjs --workspace <root>` explicitly supplies a workspace for the same route reconciliation.
- API v1: `GET /api/projects` (cursor/limit/includeArchived/budgetBytes), `GET /api/projects/:id`, `GET /api/projects/:id/summary`, `GET /api/projects/:id/sections/:section` (budget/cursor), `PATCH /api/projects/:id` (validated status/stage with optimistic revision), and `POST /api/projects/:id/records` (Project record v1 schema; reject extra fields and oversized serialized records). Import routes are `POST /api/projects/:id/imports/preview` with `{sources}`, `POST /api/projects/:id/imports` with `{sources, planHash}`, and `POST /api/projects/:id/imports/:transactionId/rollback` with `{apply}`. Preview and transaction metadata expose source rows `{path, sha256, size}` (transaction rows also reference the preserved source snapshot); rollback API errors preserve safe `error.details.conflicts[]` fields `{path, reason, expected?, actual?}`. API and CLI use the same store and validators.

## Legacy import contract

- Sources are supplied explicitly and must resolve within the selected project root by default; never search other workspaces.
- Recognize selected Progress/Plan/Problem-style Markdown deterministically. Dry-run is the default and performs no writes. Report source path/hash, proposed domain mapping, exact/probable duplicates, target conflicts, ambiguous status, and unmapped content.
- Progress entries become imported project-level history; Plan entries remain unclassified project plan candidates, not Tasks; Problem entries remain unclassified risk/question candidates. Never infer completion, status, or Task closure.
- Apply requires the reviewed dry-run plan hash. Preserve source bytes, source references, provenance and a transaction snapshot. Do not overwrite conflicts or delete source data.
- Rollback defaults to preview and only reverses files/records owned by the transaction whose hashes still match. If later content changed, refuse and report conflict.

## Acceptance criteria

| ID | Criterion | Evidence | Status |
|---|---|---|---|
| AC-001 | Two generated projects managed by the same CLI/API retain independent Project and Task state; same Task IDs cannot cross-route. | Project isolation and overwrite/backup preservation regressions pass; full `npm test` is 650/0/1 skip. Independent review remains. | review-pending |
| AC-002 | Project owns project-level facts; Task owns execution facts; Task updates produce correct generated Project rollups without duplicating Task fields. | Generated Task summaries and >8 KiB INDEX rollups pass focused tests; full `npm test` is 650/0/1 skip. Independent review remains. | review-pending |
| AC-003 | Workspace/Project/Task routing stays within byte limits, shards/paginates large indexes, and default routing does not read all Project documents, Task capsules, or history. | `project-store-review-regressions.test.js` passes 8/8 for exact final bytes, bounded domain/progress reads, structural index checks, capped search, duplicate-ID/query-bound cursors, and CLI pagination. Combined Project state/routing/store/transaction regressions pass 34/34; full-suite revalidation remains. | review-pending |
| AC-004 | Explicit-source import dry-run is write-free and reports mappings/duplicates/conflicts/unmapped/unknown statuses; confirmed apply preserves sources; rollback is hash-guarded. | `tests/project-import.test.js` passes 8/8 and full `npm test` is 650/0/1 skip, covering rollback, actual-byte bounds, provenance and API errors. Independent review remains. | review-pending |
| AC-005 | Task archives keep the existing physical dated move and safety gates; archived Tasks remain routable. Project archive changes lifecycle/routing only and never moves its repository root; restore works. | `project-transaction-regressions.test.js` passes 5/5, including tampered-stage rejection; existing Project state/routing tests pass. Transaction review remains pending. | review-pending |
| AC-006 | Package source, generated templates, API, CLI, schemas, and validator remain aligned; strict generated-project validation and regression suite pass. | Full `npm test` 650/0/1 skip, E2E 177/177, pack smoke 3/3, and mirror checks pass. Strict generated-project tests pass; root pre-push strict gate remains blocked by GATE-001. Independent review remains. | review-pending |
| AC-007 | `wf-review` is method-neutral and uses risk-based independent review, evidence-structured findings, targeted challenge, and controller evidence adjudication without majority-vote acceptance. All source/template/runtime mirrors and validators agree; unrelated WF-MAX/WF-AUTO CLI rules remain unchanged. | `npm test` 663 pass/1 platform skip; generator 41/41; validator tests 55/55; E2E 177/177; package smoke 3/3; build-version and root checksum check pass. Independent policy review remains pending. | review-pending |
| AC-008 | Prepare a 0.9.7 local release candidate only after all required tests, version/checksum checks, strict validators, and release artifact checks pass; do not mutate remote release channels without separate explicit confirmation. | Done: 0.9.7 candidate built and verified (pre-push 9/9), committed as `d732240`, tagged `v0.9.7`, origin/main fast-forwarded, GitHub Release created as a draft, update channel serving 0.9.7. npm publish left to the user as instructed; legacy mirror not pushed. | done |
| AC-009 | Archive is lifecycle-driven, not count-driven: SessionStart safely archives only closed, closeout-verified eligible capsules by default; explicit opt-out/dry-run works; active or unsafe capsules remain live; strict validation has no arbitrary total-count failure; indexes/history remain consistent. | Verified: default/opt-out/dry-run/Stop, legacy dead-PID lock recovery, eligible vs ineligible capsules (active/blocked/unverified/question/queue/focus), 8 live capsules with no count failure, idempotence, concurrent SessionStart, rollback and index/revision alignment are covered by passing tests. Applied the approved archive to 5 verified capsules; `task-project-tasks-upgrade` stayed live because it is active. Root and template strict validators now pass. | done |

## Test plan (TDD)

1. Write AC-linked RED tests before production implementation.
2. `tests/project-state.test.js`: schema, init/update/archive/restore, byte limits and derived summary.
3. `tests/project-routing.test.js`, `tests/project-store-review-regressions.test.js`, and `tests/project-transaction-regressions.test.js`: route-only indexes, bounded/exact-byte pagination and search, structural schema checks, and crash/failure recovery.
4. `tests/project-import.test.js`: dry-run no writes, source mapping, duplicates/conflicts/unmapped content, no status inference, confirmed apply, hash-guarded rollback and failure recovery.
5. `tests/project-api.test.js`: API list/show/summary/section/update/import behavior matches CLI and enforces project scope.
6. Run existing `tests/task-state.test.js`, task route/archive regressions, generator/CLI smoke/anti-drift/validator tests; then `npm test` and package smoke.

## Write set and forbidden scope

**Write set:** `templates/common/Harness/project/**`; shared Project modules/CLI under `templates/common/Harness/scripts/`; `templates/common/Harness/scripts/task-state.mjs`, `auto-archive-session-start.mjs`, `validate-harness.mjs`, `TASK_ARCHIVE.md`, and generated Task indexes/root progress as needed; `src/wf-ui-server/server.mjs` and focused API helpers/tests; `src/generator.js`/ownership metadata when generation requires it; Project/task-archive tests under `tests/`; the approved `wf-review` skill, reviewer/manager guidance, command wrappers, workflow/router docs, validator assertions, focused tests, and source/template/root mirrors; `package.json`, `CHANGELOG.md`, and generated Harness version/ownership manifests only for local 0.9.7 preparation after functional checks pass.

**Forbidden:** pre-existing modified/untracked paths reported by `git status` except the explicit Project, wf-review, archive-policy, and release write sets above; `Harness/a2a/**` except the wf-review prompt in `Harness/a2a/workflows.json`; `Harness/extensions/**`, `Harness/integrations/**`, `crates/wf-cli/target/**`, `docs/superpowers/specs/**`, `evidence/**`, generated UI test artifacts, unrelated files; `Harness/tasks/_archive/**` except safe auto-archive output for capsules that pass the approved eligibility checks (move only, no content edits/deletions); external workspaces; deleting user data; rewriting an existing release tag or GitHub Release; commit/push/tag/npm publish/remote mirror mutation without a separate explicit confirmation.

## Decisions and risks

| # | Decision / risk | Mitigation |
|---|---|---|
| 1 | Keep current Task archive as a physical move; Project archive is metadata + route filtering only. | Preserve current Task archive tests; never move a Project root. |
| 2 | The workspace route catalog can grow and may drift from Project status. | Sharded route-only indexes, atomic archive/restore updates, validator reconciliation; Project manifest remains status source of truth. |
| 3 | Legacy source formats are not known in advance. | Explicit source selection; deterministic parser; unresolved content stays unclassified and is preserved. |
| 4 | Multi-file import cannot be a single filesystem atomic write. | Staging, journal, per-file hashes, rollback only for unchanged transaction-owned outputs. |
| 5 | Initial byte limits may be too small/large for real fixtures. | Start with 4/8 KiB limits, exercise large CJK and path fixtures, adjust only with explicit tests and route-profile update. |
| 6 | Canonical and legacy GitHub v0.9.6 releases point to commit `8650319`; prior evidence recorded npm latest=0.9.5 and no 0.9.6, while the current uncommitted Project work is not in that release. User has now approved assessing/preparing 0.9.7. | Keep v0.9.6 immutable; assess a new 0.9.7 candidate. No commit/push/tag/npm publish/remote mirror mutation until separate explicit confirmation and all release gates pass. |
| 7 | `wf-review` should improve finding quality and multi-reviewer adjudication without prescribing CLI/runtime/model or using reviewer majority as truth. | Implement the approved method-neutral, evidence-first, risk-based independent review with selective challenge and controller adjudication; keep unrelated workflow CLI policies unchanged. |
| 8 | Task archives are physical, but a total live-capsule count is not a correctness limit. Automatic moves must be safe and based on verified lifecycle state, not a magic number. | Default-on SessionStart archival only for closed + closeout-verified capsules passing existing owner/lease/lock/focus/question/queue checks; keep dry-run and explicit opt-out; remove count-only strict failures. |

## Review remediation matrix

| Finding | AC | Required correction | Regression evidence |
|---|---|---|---|
| REV-GEN-01 Project state overwritten on regeneration | AC-001/006 | Existing `Harness/project/**` data, including stable Project ID, is preserved under overwrite/backup policies. | Regenerate fixture with altered Project state and assert byte-identical state. |
| REV-STORE-01 Pagination reads all domain records and progress segments | AC-003 | Select filename-derived IDs before opening bodies; progress uses an opaque project/section/segment/ordinal cursor and does not reread consumed segments. | Corrupt unrequested domain record and instrument continuation to ensure prior progress segment bodies are not reopened. |
| REV-STORE-02 Task rollup rejects large task index | AC-002/003 | Derive status counts for Task indexes larger than 8 KiB without opening individual Task capsules; keep output bounded. | Large INDEX fixture with correct counts and response-byte assertion. |
| REV-STORE-03 Runtime record validation/size gaps | AC-003/006 | Enforce the versioned Project record schema and final serialized-byte cap on writes and reads. | Invalid type/date/source/ids and oversized record rejection tests. |
| REV-LIST-01 Local list semantics diverge | AC-005/006 | Local CLI/API list hide archived Projects by default and honor bounded output/pagination consistently with workspace listing. | Local CLI/API archived and small-budget request tests. |
| REV-IMPORT-01 Rollback can partially restore | AC-004 | Validate every required snapshot and hash before modifying any output. | Corrupt later snapshot; assert all outputs remain at post-import bytes and transaction stays applied. |
| REV-IMPORT-02 Source byte cap is TOCTOU-prone | AC-004 | Enforce per-source and aggregate limits while reading actual bytes, not only via prior stat. | Lie about stat size while source exceeds cap; preview/apply rejects. |
| REV-IMPORT-03 Source provenance/API errors incomplete | AC-004/006 | Return source path/hash/size in preview, persist source rows in transaction metadata, and preserve safe structured error details across API/CLI. | CLI/API preview and conflict parity tests. |
| REV-VALIDATE-01 Workspace route reconciliation missing | AC-005/006 | Explicit workspace validation checks route roots/status against Project manifests. Root/template workspace-index schema parity is already satisfied. | Stale route/root validation fails before remediation; schema parity regression passes. |
| REV-STORE-04 Search performs unbounded full scans and caches all matches | AC-003 | Add a finite per-request scan ceiling, deterministic cursor continuation, and retain only bounded page results. | Instrumented search confirms the ceiling stops record-body reads and reports a continuation or budget boundary. |
| REV-STORE-05 Page `bytes` undercounts final JSON and section readers open bodies later excluded by byte budgeting | AC-003 | Measure finalized payloads and apply byte budgeting while consuming records/segments incrementally. | Tight-budget tests assert exact JSON byte length and that only returned records plus at most one boundary candidate are opened. |
| REV-STORE-06 Index validation depends on JSON property order | AC-003/006 | Validate exact keys and values structurally in both section reads and tree validation. | Reordered valid keys pass; extra/missing keys or incorrect values fail. |
| REV-ROUTE-02 Charter/revision and Project lifecycle/route transitions can split on process interruption | AC-003/005 | Use staged, hash-checked, idempotent journals and recover before reads/writes; preserve route-only stubs and project roots. | Injected failure and child-process crash tests recover to consistent charter/revision and exactly one status-matching route. |

## Subagent Dispatch

| ID | Role | Task / AC | Read set | Write set | Dependency | Status |
|---|---|---|---|---|---|---|
| ARCH-01 | architect | Recommend minimal bounded pagination/Task-rollup/validator design; AC-002/003/005/006. | Store, Task index builder, schemas, CLI, validator, architecture, and this PLAN. | none | Recommendations informed the implementation wave; output is recorded in the storage and routing contract. | complete |
| TW-01 | test-writer | Add AC-linked RED tests for REV-GEN-01, REV-STORE-01..03, REV-LIST-01, REV-IMPORT-01..03, and REV-VALIDATE-01. | This PLAN, the two Project schemas, `tests/support/project-management.js`, and existing Project/generator tests only; must not inspect production implementation. | `tests/generator.test.js`, `tests/project-state.test.js`, `tests/project-routing.test.js`, `tests/project-import.test.js`, `tests/project-api.test.js` | First; controller corrected fixture/API-contract assumptions and reran focused suite; source edits may begin. | RED-confirmed |
| IMP-01 | implementer/controller | Fix importer rollback, actual-byte limits, source provenance; AC-004. | This PLAN, importer tests, and Project import/store code. | `templates/common/Harness/scripts/lib/project-import.mjs`, `Harness/scripts/lib/project-import.mjs` | Added bounded descriptor reads and pre-staging size checks; import tests now pass 8/8 with the completed store code; mirrors match. | complete |
| IMP-02 | implementer/controller | Fix bounded Project reads, large Task rollups, record schema/size validation, local-list pagination helper, progress segment cursors, and workspace route reconciliation; AC-002/003/005/006. | This PLAN, store/routing/state/API tests, Project schemas, store code. | `templates/common/Harness/scripts/lib/project-store.mjs`, `Harness/scripts/lib/project-store.mjs` | Store and controller changes now pass the full Project-focused suite (77/77), including progress continuation, bounded JSON reads, large Task INDEX, and route validation. | complete |
| IMP-03 | implementer | Preserve Project user state across generator overwrite/backup; AC-001/006. | This PLAN, generator tests, generator code. | `src/generator.js` | After TW-01 RED. | complete |
| CTRL-01 | controller | Integrate local-list helper in CLI/API, reject unsupported record payload fields, preserve structured import error details, and pass explicit workspace roots through strict validation; AC-004/005/006. | This PLAN, RED tests, CLI/API/validator source. | `templates/common/Harness/scripts/project-state.mjs`, `Harness/scripts/project-state.mjs`, `src/wf-ui-server/server.mjs`, `templates/common/Harness/scripts/validate-harness.mjs`, `Harness/scripts/validate-harness.mjs` | CLI/API/validator integration passes the full Project-focused suite (77/77). | complete |
| TX-01 | implementer | Add recoverable charter and workspace route transactions; AC-003/005. | This PLAN, `tests/project-transaction-regressions.test.js`, store and routing contracts. | `templates/common/Harness/scripts/lib/project-store.mjs`, `Harness/scripts/lib/project-store.mjs` | Five interruption/tamper regressions pass; existing Project state/routing suite is green; journal metadata remains transaction-only. | review-pending |

## Implementation phases

1. Confirm generator/template ownership and API start-root conventions; finalize schema and API tests.
2. Add AC-linked failing CLI/model/routing/API/import tests.
3. Implement Project schemas, sharded storage, route-only workspace index, byte-bounded views, and validator.
4. Implement CLI/API operations and Task-derived Project summaries; preserve Task archive behavior.
5. Implement explicit-source transactional import and rollback.
6. Verify fresh generated projects, template parity, strict validation, focused regressions, full `npm test`, and package smoke; record AC result matrix.
