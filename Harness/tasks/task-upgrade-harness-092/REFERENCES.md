# task-upgrade-harness-092 - REFERENCES

## Canonical evidence index

| Evidence | Pointer | What it establishes | Status |
|---|---|---|---|
| E-01 | `CLAUDE.md` (Harness Binding, Active Task Resume, WF rules) | backend-owned A2A state; hydration; active pointer/STATE resume; task-scribe exception; no source edits by controller in WF-MAX contract | verified read |
| E-02 | `Harness/specs/workflows/WF.md:1-168` | dynamic ready-queue WF; tier selection; Standard review; state ownership; context/order | verified read |
| E-03 | `Harness/specs/workflows/WF-STATE.md:1-260` | canonical STATE, queues, workItems, links, lifecycle, dispatch ledger, legacy status normalization | verified read |
| E-04 | `Harness/specs/runtime/subagents.md:21-252` | role matrix, Luna worker boundary to be applied by controller, native-first/peer CLI fallback, no undocumented config, evidence handoff | verified read |
| E-05 | `Harness/specs/runtime/dispatch.md` | dispatch packet fields, request/evidence/verification boundary | verified read; W1 must map exact envelope |
| E-06 | `Harness/specs/runtime/context-loading.md:41-204` | cache-first stable loads, role-specific pack, finite context, raw transcript exclusion, recovery paths | verified read |
| E-07 | `Harness/specs/protocols/MEMORY_PROTOCOL.md`; `.claude/skills/wf-learn/SKILL.md` | routed memory, scope/evidence and anti-overfitting direction; implementation gaps require runtime proof | verified read; W0/W1 to detail |
| E-08 | `Harness/specs/protocols/HARNESS_BRIDGE.md:1-508` | same backend/UI bridge, typed observations/actions, no direct A2A state edits, CLI/browser evidence boundary | verified read |
| E-09 | `package.json:3,29-41`; `Harness/.harness-version` | Initial audit baseline was 0.9.1; the current working tree now carries the 0.9.2 candidate version and generated release metadata, while exact pushed-SHA provenance is still absent. | verified read; candidate, not release acceptance |
| E-10 | `README.md:70-95,246-257`; `README-CN.md:229-231`; `CHANGELOG.md:3-21` | current install/update/release docs and historical npm/mirror gates; explicit user no-publish supersedes for this task | verified read |
| E-11 | `git status --short`; `git diff --stat`; `git branch --show-current`; `git log -5 --oneline` | branch/HEAD and broad dirty baseline; 3080 assets/A2A state must remain | command snapshot |
| E-12 | `Harness/tasks/INDEX.json`, `Harness/PROGRESS.md`, existing task STATE files | five previous outer tasks, active focus transition, old task ownership must be preserved | verified read |
| E-13 | W0-RUNTIME report (scoped runtime/source audit) | existing typed `create/start/restart/sendMessage/readMessages`; A2A `messageId/threadId/requestId/replyTo/contextRefs`; peer-capsule `REQUEST/STATE/events/RESULT`; branch/HEAD baseline | report received; W1 must locate exact symbols/paths |

## Command log

| Date | Command | Result / artifact |
|---|---|---|
| 2026-09-09 | `node Harness/scripts/task-state.mjs record task-upgrade-harness-092 --create ... --mode wf --project harness-upgrade --apply --json` | created active task; initial state emitted |
| 2026-09-09 | `node Harness/scripts/task-state.mjs set-active task-upgrade-harness-092` | rewrote allowed root `Harness/PROGRESS.md` pointer/index; did not close old tasks |
| 2026-09-09 | `node Harness/scripts/task-state.mjs --help` | canonical commands confirmed: query/list/index/validate/reconcile/transition/archive |
| 2026-09-09 | `git status --short` / `git diff --stat` | large pre-existing dirty tree; preserve baseline; see E-11 |
| 2026-09-09 | `node Harness/scripts/task-state.mjs reconcile --apply --json` | synchronized task/root progress phase and active pointer; no errors/warnings in reconcile |
| 2026-09-09 | `node Harness/scripts/task-state.mjs query task-upgrade-harness-092 --json` | `ok:true`, count 1, active/plan, no query warnings |
| 2026-09-09 | `node Harness/scripts/task-state.mjs validate --json` | `ok:true`, errors 0; warning only: six outer tasks vs cap five; old tasks remain active |
| 2026-09-09 | `git diff --check` | no whitespace errors; only pre-existing CRLF normalization warnings |
| 2026-09-09 | `node Harness/scripts/task-state.mjs query task-upgrade-harness-092 --project harness-upgrade --json` | `ok:true`, count 1; canonical task remains active/implement; no query warnings |
| 2026-09-09 | `node Harness/scripts/task-state.mjs validate --json` | `ok:true`, 0 errors; existing warnings only: missing STATE for `task-make-wf-lifecycle-0908` and six outer tasks over displayed cap five |

## External reuse ledger (W0-EXTERNAL report; controller must verify primary links before adoption)

| Source / official URL | License / use status | Candidate idea | Decision / evidence |
|---|---|---|---|
| Anthropic, [Building effective agents](https://www.anthropic.com/research/building-effective-agents) | prose/reference; no code copied | simple composable agent patterns and evaluator loop | adapt only where AC evidence proves runtime closure; recheck URL/date |
| Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | prose/reference; no code copied | context as finite, task-specific budget | adapt into context pack contract; measure repeated context and recovery |
| Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | prose/reference; no code copied | resumable long-running handoff/evaluation | adapt with STATE/A2A idempotency; verify against holdout |
| OpenAI, [Harness engineering](https://openai.com/index/harness-engineering/) | prose/reference; no code copied | repository/agent harness feedback loops | adapt only as process evidence; no claim of equivalence |
| [deepseek-ai/DeepSeek-Harness](https://github.com/deepseek-ai/DeepSeek-Harness) | MIT (reported; verify repository LICENSE) | harness structure/evaluation ideas | adapt/reject per API/runtime fit; no Python dependency by default |
| Hugging Face [smolagents agents reference](https://huggingface.co/docs/smolagents/en/reference/agents) | Apache-2.0 codebase (verify version) | `managed_agents`, `max_steps`, `final_answer_checks` as bounded concepts | adapt contracts only; reject dependency import; test failure/step limits |
| Hugging Face [ScreenSuite](https://huggingface.co/blog/screensuite) | benchmark/report; verify terms | hierarchical/holdout evaluation framing | adapt benchmark design; do not borrow scores or claim SOTA |

W0 trigger policy: search only for a capability gap, explicit newness request, public API/version change, repeated failure, or benchmark-discovered deficit. Each later entry must include source version/date, license/terms, adopt/adapt/reject, reason, counterexample, and recheck/expiry trigger. Retrieval feedback (hit/useful/contradictory/stale) is required before promoting a method to reusable memory.

## Current checkpoint evidence (2026-09-09)

| Evidence | Pointer | What it establishes | Status |
|---|---|---|---|
| E-14 | `PLAN.md#Current implementation-fix / independent-verify checkpoint`; `evidence/verify-context-memory-092.md` | Historical context REDs were repaired; independent context/boundary/core checks and the self-contained portability fixture are now green. The old RED wording is retained only as history. | superseded current wording; local evidence, not AC acceptance |
| E-15 | `evidence/verify-chat-effort-092.md`; `evidence/verify-effort-server-092.md`; `evidence/verify-runtime-release-readiness-092.md` | Latest independent local checks: structured chat effort 4/4, effort/server/settings 5/5, server integration 42/42, driver subset 34/34, lifecycle plus CLI 9/9. | current local evidence; not formal benchmark acceptance |
| E-16 | `Harness/tasks/task-upgrade-harness-092/evidence/verify-release-portability-budget-092.md` | Portability/context-budget lane is 49/49; `cache-diagnostics-route` is 35702/36000 bytes and the verifier no longer depends on the unsubmitted task. | current local evidence; not benchmark acceptance |
| E-17 | `PLAN.md#Scope checklist (preserved; not an acceptance downgrade)` | Original comprehensive scope is retained; CLAUDE philosophy/routing and rules-policy are additive candidates, not replacements | recorded |
| E-18 | `PROGRESS.md#Current checkpoint` | Workflow/docs author checks are generator 38/38 and policy 4/4; independent integration audit/recovery is assigned to `verify_integration_092`; all ACs and release/benchmark remain pending | recorded |
| E-22 | `evidence/original-needs-status-092.md` | Original research, 17-command, routing, context/memory, cross-runtime/A2A, backend/UI, reuse, competitor, and exact-SHA benchmark scope remains explicit; unimplemented/post-push items are not relabeled complete. | current scope map; all AC pending |
| E-23 | `evidence/claude-luna-readiness-092.md` | Historical configuration-only snapshot selected `fable` + `xhigh` without proving exact Luna capability. | superseded by bounded quick-probe E-26; retained as history |
| E-25 | `evidence/verify-server-version-092.md` | Independent server-version check is 1/1 with related 43/43 green; local consistency evidence, not exact-SHA release acceptance. | current bounded evidence; all AC pending |
| E-26 | `evidence/claude-quick-probe-092.md` | User-confirmed Claude CLI quick probe succeeded with exact `gpt-5.6-luna` modelUsage and no fallback; xhigh is requested-only and CLI `total_cost_usd` is not provider billing. | current bounded probe; not formal benchmark acceptance |
| E-27 | `PROGRESS.md#Latest independent verification checkpoint (2026-09-10)`; `tests/node-composition-*.test.mjs`; `tests/benchmark/node-composition-http.benchmark.test.mjs`; `src/wf-ui-server/__tests__/`; `src/ui/e2e/` | Latest local verification: composition/API/matrix/hardening/consistency/HTTP benchmark 23/23; server/runtime/action 124/124; M2 9/9; M3 full 29/30 with one flaky drag result, targeted key M3 5/5 and corrected settings contract; UI typecheck/build pass. | current implementation evidence only; full M3 rerun/flake classification, B1-B6 exact-SHA fresh-install/real Luna/baseline/holdout benchmark, and P0/P1 API audit remain missing; all ACs pending |

## Runtime reuse ledger (W0-RUNTIME)

| Existing surface | Reuse decision | Missing contract to implement/test | Evidence owner |
|---|---|---|---|
| typed `create/start/restart` | adopt/bind | lifecycle idempotency key, restart recovery and no duplicate execution | W1 architect + runtime worker |
| typed `sendMessage/readMessages` | adopt/bind | cross-CLI envelope correlation, ack/result persistence, replay-safe read | W1 architect + verifier |
| A2A `messageId/threadId/requestId/replyTo/contextRefs` | adopt as canonical correlation | required/optional fields, dedup key, timeout/upgrade semantics | W1 contract |
| peer-capsule `REQUEST/STATE/events/RESULT` | adapt for durable handoff | event ordering, state snapshot, result ack and recovery checkpoint | W1 + AC-05 verifier |
| backend auto-prepare + optional UI attach | keep as separate behavior | CLI can start backend without browser; UI observes same task/index | runtime worker + AC-06 verifier |

Do not rebuild these primitives or claim implementation until exact source symbols and real cross-runtime evidence are recorded.

## Bounded primary-source verification (2026-09-09)

This is a targeted recheck of the seven ledger records plus the three Claude
Code documentation pages needed to distinguish documented behavior from local
implementation. It is not a general web survey. No source code was copied or
vendored. For prose pages, a code license is not applicable; repository
license facts are recorded only where a repository is an adoption candidate.

| Source (official page/snapshot) | Observed date / release / license | Adopt / adapt / reject and reason | Counterexample / recheck trigger |
|---|---|---|---|
| Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Published 2024-12-19; prose, license N/A. The page warns that tooling described has changed since publication. | **Adapt** simple composable workflow/agent patterns and evaluator loop as design guidance; do not claim equivalence or copy code. | Counterexample: a local fixture pass can still hide provider/runtime failure. Recheck when Anthropic updates the page/current Managed Agents docs or local B3 finds routing/evaluator drift. |
| Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Published 2025-09-29; prose, license N/A. Describes context as finite and recommends curation/progressive disclosure. | **Adapt** finite role/task packs, bounded bytes, and just-in-time references; local pack behavior must still be measured independently. | Counterexample: a valid pack can be stale if STATE/handoff is not refreshed. Recheck on page/API revision or a context duplication/recovery failure. |
| Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Published 2025-11-26; prose, license N/A. Describes initializer/coding-agent sessions and explicit progress artifacts. | **Adapt** resumable artifacts and incremental work into task STATE/peer evidence; **reject** any claim of Claude SDK equivalence. | Counterexample: tools are explicit writers and do not automatically maintain parent queues/handoff. Recheck on SDK/session semantics changes or recovery benchmark failure. |
| OpenAI, [Harness engineering](https://openai.com/index/harness-engineering/) | Published 2026-02-11; prose, license N/A. Describes repository knowledge as a structured system of record and feedback loops. | **Adapt** repository legibility, structured docs, and feedback-loop principles; **reject** SOTA/equivalence claims and copied implementation. | Counterexample: local docs/mirrors may be structurally complete while release provenance is absent. Recheck when the article is revised or AC-02/08 finds knowledge-state drift. |
| GitHub [deepseek-ai/DeepSeek-Harness](https://github.com/deepseek-ai/DeepSeek-Harness/commit/5dda764ed3aa172535a7967b06ff95d9cbfe536a) | `master` latest observed merge `5dda764ed3aa172535a7967b06ff95d9cbfe536a`, 2026-09-08, release `dsh@0.1.5-alpha.1`; [LICENSE](https://raw.githubusercontent.com/deepseek-ai/DeepSeek-Harness/master/LICENSE) is MIT. | **Adapt/reject dependency**: reuse only high-level plugin/evaluation ideas where contracts fit; reject importing Python/official runtime or treating local DeepSeek-named A2A as upstream reuse. | Counterexample: same names do not establish code provenance or API compatibility. Recheck on upstream release/commit change, license change, or a needed dependency. |
| Hugging Face [smolagents agents reference](https://huggingface.co/docs/smolagents/en/reference/agents) and [release list](https://github.com/huggingface/smolagents/releases) | Docs warn API is experimental/changeable; latest observed release `v1.26.0` (commit `12c1bc8`, 2026-05-29 in the release page); [LICENSE](https://raw.githubusercontent.com/huggingface/smolagents/main/LICENSE) is Apache-2.0. | **Adapt concepts only**: bounded `max_steps`, managed-agent/final-answer checks; reject adding the Python dependency or claiming its agent semantics are this runtime. | Counterexample: upstream API/version changes and local PTY/capability contracts differ. Recheck on a new release/API change or benchmark failure involving step limits/managed agents. |
| Hugging Face [ScreenSuite](https://huggingface.co/blog/screensuite) and [repository snapshot](https://github.com/huggingface/ScreenSuite/commit/aa10fe33edcbaf09a674828ae0a4d8458896ffa1) | Blog published 2025-06-06; latest observed `main` commit `aa10fe33edcbaf09a674828ae0a4d8458896ffa1` (2026-04-02); [LICENSE](https://raw.githubusercontent.com/huggingface/ScreenSuite/main/LICENSE) is Apache-2.0. Blog describes 13 visual/multistep benchmarks and vision-only evaluation. | **Adapt** category separation, visual-only oracle boundary, and holdout framing; reject borrowed scores and any “most comprehensive/world-leading” claim for this project. | Counterexample: a local PNG oracle is not a ScreenSuite score or full GUI benchmark. Recheck on repo/benchmark revision or when B6 design changes. |
| Claude Code [custom subagents](https://code.claude.com/docs/en/sub-agents) | Official docs observed 2026-09-09; current page documents project/user/managed scopes, model aliases/full IDs, and available-model substitution; docs are not a source-code license. | **Adapt documentation semantics only** for explicit subagent scope/model configuration; do not infer Claude gateway availability for `gpt-5.6-luna`. | Counterexample: Claude's `availableModels` strings alone do not provide trusted effort metadata. Recheck on Claude Code version/docs changes and before strict Luna B3. |
| Claude Code [agent teams](https://code.claude.com/docs/en/agent-teams) | Official docs observed 2026-09-09; teams are explicitly experimental, model selection can be substituted by an allowlist, and teammates inherit lead effort; no code license applies. | **Adapt** model/effort provenance and experimental-warning concepts; reject using teams as proof of this runtime's A2A or typed dispatch. | Counterexample: model substitution can silently violate strict Luna unless warning/allowlist is observed. Recheck on teams/model/effort semantics changes. |
| Claude Code [skills](https://code.claude.com/docs/en/skills) | Official docs observed 2026-09-09; project/personal/enterprise skill locations and `SKILL.md` frontmatter/body are documented; no code license applies. | **Adapt** discoverable skill packaging and explicit scope; reject assuming skill presence means successful runtime execution. | Counterexample: mirrored files can exist while command behavior is unverified. Recheck on skill loading/frontmatter changes or a command-surface regression. |

### Source adoption boundary

The three sources named normatively by `CONTRACTS.md` and the seven-source
ledger in this file are different-purpose lists. The former is a shorter
contract pointer set; the latter includes research candidates and compatibility
references. Their counts do not conflict unless their applicability rules
contradict; this recheck found no such contradiction. All AC statuses remain
pending, and these source observations do not substitute for the exact-SHA
fresh-install benchmark.

## Baseline snapshot

- Current branch: `agent/wf-ui-state-checkpoint-20260804`; HEAD: `0212e16` (`Add init --scope project for classic project-level install`).
- Initial audit snapshot recorded package/generator 0.9.1 while the working tree was heavily modified. The current working tree now reports candidate 0.9.2; this is still not a clean pushed release branch.
- Untracked `3080.md`, `3080-xianyu-cover.png`, A2A node state, task index/archive and other local artifacts are explicitly preserved.
- No commit, push, publish, reset, clean, checkout, or source edit was performed by task-scribe.
