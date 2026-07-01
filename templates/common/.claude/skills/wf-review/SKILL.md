---
name: wf-review
description: Use for /wf-review in Claude Code, $wf-review or /skills wf-review in Codex, peer review, second opinion, or cross-model review.
---

# WF Review Adapter

Use the other available agent CLI for independent review. Never simulate a
cross-model review with the same model.

## Invocation

- Claude Code: use `/wf-review [focus]` or select the `wf-review` skill.
- Codex CLI or IDE: use `$wf-review` or `/skills` then choose `wf-review`.

## CLI Direction

| Runtime | Command |
| --- | --- |
| Claude Code -> Codex | `git diff | codex exec "<5-dimension review prompt>"` |
| Codex -> Claude Code | `git diff | claude -p "<5-dimension review prompt>"` |
| Only one CLI | Warn user. Do not self-review. |

## Review Dimensions

Cover correctness, security, architecture, performance, and tests. Classify
findings as Critical, High, Medium, or Low. Return raw peer output first, then
your severity-classified synthesis.

## Context

Include the relevant diff, `Harness/architecture.md` when architecture is in
scope, and any task acceptance criteria. If the diff is too large, ask for a
narrower scope before invoking the other CLI.
