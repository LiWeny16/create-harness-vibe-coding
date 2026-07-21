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

## Review Dimensions

Cover correctness, security, architecture, performance, and tests. Classify
findings as Critical, High, Medium, or Low. Return raw peer or subagent output
first, then the controller's severity-classified synthesis.

## Reviewer Role Fallback

When using a same-runtime subagent fallback, dispatch a real role packet instead
of an ad hoc prompt:

```text
Role: reviewer
AgentName: reviewer
Mode: read-only
Objective: review the current diff for correctness, security, architecture,
performance, tests, and spec/AC compliance
Read set: changed files, tests, task PLAN/PROGRESS, Harness/agent-workflow.md,
Harness/subagents.md, Harness/dispatch.md, architecture docs when affected
Write set: none
Forbidden: file edits, git mutations, formatting-only advice, ungrounded claims
ReturnSchema: findings by severity, file/line refs, missing verification,
open questions, closeout recommendation
```

If the runtime exposes `review-manager`, use it only when the diff is broad
enough to benefit from multiple reviewer dimensions. The controller must
deduplicate reviewer output and decide what to accept.

## Context

Include the relevant diff, `Harness/architecture.md` when architecture is in
scope, and any task acceptance criteria. If the diff is too large, ask for a
narrower scope before invoking a peer CLI or reviewer subagent.
