# Harness 0.9.2 Business Contracts

Status: frozen at W1 architecture gate; current gate is
`implementation-fix/independent-verify`. W2 RED evidence is historical; no
acceptance criterion is marked complete.
The parent model is the sole controller and final approver. Luna
(`gpt-5.6-luna`, `xhigh`) is used only for bounded workers (implementation,
verification, review, release, fresh benchmark execution, or scoring).
`defaultAgentRuntime` remains `codex`; a model name is never a runtime name.

## 1. Scope and ownership

- `STATE.json` is the canonical task truth. `PROGRESS.md`, `PLAN.md`, and
  this file are evidence, not a second state store.
- Task-scribe may write only this task capsule and may use canonical
  `task-state.mjs` to update the allowed root pointer/index. Source workers
  have explicit disjoint write claims; they do not write task state, memory, or
  `Harness/a2a/**` state.
- The root `nextAction` in `STATE.json` is the only next-action field. The
  optional `context` object has no competing next-action value.
- W6 release actions are performed by a Luna release worker only after the
  parent model records final acceptance. `npm publish` is always forbidden.

## 2. Task context API (AC-02, AC-03)

The implementation adds `Harness/scripts/task-context.mjs` and matching
templates. Its deterministic CLI surface is:

```text
node Harness/scripts/task-context.mjs update|show|pack <taskId> \
  --project <absolutePath> --input <jsonFile> --role <role> \
  --budget-bytes N --json
```

`update` requires `--apply`; without it the command is a dry-run and must
not write. `update` requires an input JSON file. `show` reads the task and
may omit input, role, and budget. `pack` requires a role and byte budget and
reads the canonical task/context plus the supplied input. Unknown
task/project, malformed JSON, negative budget, missing required options, and
writes without `--apply` are explicit errors.

`STATE.json.context` is optional for legacy tasks and, when present, contains
only these fields (no new store):

```text
intent { original, current, changes[{summary,reason,source}] }
constraints[]
facts[{id,text,source,status}]
assumptions[{id,text,status,evidenceRefs}]
decisions[{id,decision,reason,rejectedAlternatives,evidenceRefs}]
evidence[{id,path/url,claim,status}]
attempts[{id,action,outcome,evidenceRefs}]
handoff { summary, unresolved[] }
```

`intent.original` is immutable after first write. Later updates append a
`changes` entry and may update `current`, but may not replace the original.
Facts, assumptions, decisions, evidence, and attempts retain IDs and status so
failed or superseded reasoning is recoverable. Legacy capsules are readable
without a forced migration.

`pack` returns exactly this top-level shape (field order is stable):

```json
{"taskId":"...","role":"...","pack":"...","references":[],"omitted":[],"budget":{"limitBytes":0,"usedBytes":0},"hash":"sha256:..."}
```

`usedBytes` is the UTF-8 byte length of `pack`; it is a context-size
estimate, never provider token usage. Same task, input, role, and budget produce
the same bytes and hash. The pack must include current intent, constraints,
unresolved items, and root `nextAction` whenever they fit. If mandatory
content cannot fit, `pack` fails explicitly and does not silently omit it.
Large logs are represented by evidence paths/URLs and claims, never expanded
transcripts. Role/task applicability is represented by references; omitted
entries explain every excluded optional section. No provider-token or cost claim
may be inferred from pack bytes.

## 3. Runtime/session contract (AC-05, AC-06)

The runtime exposes:

```text
POST /api/sessions {
  dispatchId, taskId, runtime, model, effort,
  transport:'pty' (default) | 'chat', objective, initialPrompt,
  contextPackPath, contextRefs, parentSessionId, projectRoot
}
```

`runtime`, `model`, `effort`, and `transport` are explicit. Unsupported
runtime/model/effort/transport returns a clear `unsupported` error; the
service does not silently substitute another model. The response includes
`sessionId`, `status`, `replayed`, and `requested`/`effective`
selections.

For the same `projectRoot + taskId + dispatchId`, an identical payload is
idempotent: return the original session/result with `replayed:true` and
perform no second side effect. A different payload for that key is rejected.
Explicit retry is allowed only for `failed` or `cancelled`, at most once per
dispatch, and increments `attempt` by one. No implicit retry or duplicate
execution is allowed.

PTY remains a first-class transport. On restart, a session may be reused only
when a verifiable live handle exists. Without one, the session is marked
`interrupted` or `failed`; the service must not pretend that PTY can
reattach. The caller must explicitly retry. `seq` is monotonic per stream,
terminal state is unique, and `requestId`/`replyTo` are preserved through
ACK and RESULT.

The existing typed `create/start/restart/sendMessage/readMessages` APIs and
A2A/peer-capsule `REQUEST/STATE/events/RESULT` are reused. Dispatch identity,
event ordering, ACK/RESULT binding, and recovery checkpoints are additive
contracts, not a second task truth.

Backend `ensure` may start or reuse the service through CLI for the same
absolute project, under a lock that prevents concurrent starts, and returns a
URL. It never requires a browser. UI opening attaches to that already-running
backend and reads the same canonical task/index.

## 4. Memory/reuse contract (AC-01, AC-04)

Reusable memory entries carry applicability scope, evidence references,
counterexamples, status, supersede/disable links, and retrieval feedback.
`wf-learn` must support Probe -> Identify -> Act -> Verify and must not turn
one sample into a global prohibition. Conflicts, stale entries, and disabled
rules remain auditable and recoverable. External reuse decisions record source,
version/date, license/terms, adopt/adapt/reject reason, counterexample, and
recheck trigger. Reference material includes [Anthropic effective
agents](https://www.anthropic.com/engineering/building-effective-agents),
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness), and
[Hugging Face ScreenSuite](https://github.com/huggingface/screensuite); these
are evidence sources, not permission to copy code or claim SOTA.

## 5. Acceptance contract (AC-01..AC-09)

All nine acceptance criteria remain in force: command/runtime source audit and
reuse ledger (AC-01); resumable intent/context/state (AC-02); bounded real
pack dispatch/recovery (AC-03); scoped memory learning and counterexamples
(AC-04); explicit cross-runtime/A2A/PTY routing and idempotency (AC-05);
browser-free backend plus shared UI state (AC-06); independent tests and real
CLI/API/browser evidence with estimated/provider-measured metrics (AC-07);
0.9.2 build/test/pack, branch push and remote SHA with no npm publish (AC-08);
and exact-SHA fresh-install benchmark with fresh Luna execution, independent
Luna scoring, holdout, and explicit repair/rerun evidence (AC-09).

No criterion may be removed or weakened after a failure. A failure changes
implementation/evidence status, not the acceptance expectation.

## 6. Supplemental rules-policy (candidate / pending decision)

This section is additive design guidance only. It is not an implementation or
acceptance claim and cannot narrow AC-01..AC-09:

- Candidate hard-rule path: emit an event, then require an explicit gate.
- Candidate soft-rule path: retrieve scoped memory with evidence and feedback.
- Keep `CLAUDE.md` thin, limited to core philosophy and routing.
- No permission is granted to modify GitHub branch protection or branch-rule
  settings.
