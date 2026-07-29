---
name: wf-review
description: Use for /wf-review in Claude Code or OpenCode, $wf-review or /skills wf-review in Codex, peer review, second opinion, cross-runtime review, or independent reviewer subagent review.
---

# WF Review Adapter

Prefer an independent peer runtime for review. If no other CLI is available,
use the installed reviewer role as a separate subagent context. Never label a
same-runtime reviewer or bounded role pass as cross-model review.

## Invocation

- Claude Code: use `/wf-review [focus]` or select the `wf-review` skill.
- Codex CLI or IDE: use `$wf-review` or `/skills` then choose `wf-review`.
- OpenCode: use `/wf-review [focus]`; the `.opencode/commands/wf-review.md`
  wrapper routes here.

## Authority

The main agent is the controller. It owns final decisions, accepted/rejected
findings, fixes, release claims, and user-facing recommendations. Review
agents only provide evidence-backed suggestions.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: build review
context from changed-file lists, ACs, validation evidence, and targeted diffs;
avoid pasting unrelated history, full transcripts, or unused tool schemas into
the review prompt.

## Runtime Selection

1. Build one review prompt containing the relevant diff, task acceptance
   criteria, changed-file list, validation evidence, and the review dimensions.
2. Detect available CLIs (`claude`, `codex`, `opencode`) with the platform's
   normal command lookup.
3. Prefer a CLI that is not the current runtime. If several exist, prefer a
   different model/provider when known; otherwise use the first available in
   the table below.
4. If no other CLI exists, dispatch the installed `reviewer` role as a separate
   subagent context. For WF-MAX or broad/high-risk changes, use
   `review-manager` to split spec/code/security/performance dimensions when the
   runtime supports nested subagents.
5. If neither a peer CLI nor a subagent surface exists, warn that WF-REVIEW is
   degraded and perform only a controller review; do not count it as
   independent review.

| Current runtime | Preferred peer CLI | Secondary peer CLI | Same-runtime fallback |
| --- | --- | --- | --- |
| Claude Code | `codex exec "<review prompt>"` | `opencode run --agent reviewer --dir . "<review prompt>"` | Claude `reviewer` subagent |
| Codex | `claude -p "<review prompt>"` | `opencode run --agent reviewer --dir . "<review prompt>"` | Codex subagent or bounded `reviewer` role pass |
| OpenCode | `claude -p "<review prompt>"` | `codex exec "<review prompt>"` | `opencode run --agent reviewer --dir . "<review prompt>"` or OpenCode `reviewer` subagent |
| Unknown | any available peer CLI, preferring `claude`, then `codex`, then `opencode` | next available peer CLI | installed `reviewer` role subagent |

OpenCode note: `opencode run [message..]` is the non-interactive CLI path and
`--agent reviewer` selects the installed `.opencode/agents/reviewer.md` role.
However, the installed agent is `mode: subagent`; OpenCode falls back to the
default agent. Prefer same-runtime reviewer subagent over `opencode run --agent reviewer`.

For `opencode run --format json`, parse JSONL events; the stream is not a single
review result.

## Evidence-Packet Peer Review Contract

When invoking a peer CLI, use stdin prompt transport for PowerShell automation.
Return the raw evidence packet to the controller for formal acceptance.

### JSON/JSONL Validation

For `claude -p` with `--output-format json`:
- Fail if stdout is empty, non-JSON, `is_error: true`, `subtype` starts with `error_`, or no final model `text`/`result` is present.
- Do NOT use tiny `--max-budget-usd` values in real reviews; if budget is set and exhausted, record BLOCKED rather than treating it as reviewer output.

For `opencode run --format json`:
- Parse JSONL events, extract final `text` parts.
- Do NOT treat the whole JSONL stream as the review result.
- Do NOT claim `opencode run --agent reviewer` used the reviewer role unless a probe confirms the agent is a primary runnable agent. Current evidence: `.opencode/agents/reviewer.md` is `mode: subagent` and OpenCode falls back to the default agent.
- Prefer native reviewer subagent fallback inside the current runtime when OpenCode cannot run reviewer as a primary CLI agent.

General parsing rules: parse JSON/JSONL and fail on empty output, non-JSON output, explicit error events, budget errors, fallback warnings, or missing final model text.

### Controller Adjudication

The controller accepts, rejects, or escalates each finding after parsing the evidence packet. Do not pass raw output through as accepted findings without controller review.

## Review Dimensions

Cover correctness, security, architecture, performance, and tests. Classify
findings as Critical, High, Medium, or Low.

## Reviewer Role Fallback

When using a same-runtime subagent fallback, dispatch a real role packet instead
of an ad hoc prompt:

```text
Role: reviewer
AgentName: reviewer
Mode: read-only
Objective: review the current diff for correctness, security, architecture,
performance, tests, and spec/AC compliance
Read set: changed files, tests, task PLAN/PROGRESS, Harness/specs/runtime/agent-workflow.md,
Harness/specs/runtime/subagents.md, Harness/specs/runtime/dispatch.md, architecture docs when affected
Write set: none
Forbidden: file edits, git mutations, formatting-only advice, ungrounded claims
ReturnSchema: findings by severity, file/line refs, missing verification,
open questions, closeout recommendation
```

If the runtime exposes `review-manager`, use it only when the diff is broad
enough to benefit from multiple reviewer dimensions. The controller must
deduplicate reviewer output and decide what to accept.

## Context

Include the relevant diff, `Harness/project/architecture.md` when architecture is in
scope, and any task acceptance criteria. If the diff is too large, ask for a
narrower scope before invoking a peer CLI or reviewer subagent.
