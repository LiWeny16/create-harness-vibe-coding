---
name: wf-review
description: Cross-model peer review. Invokes the other agent CLI (Codex or Claude) to independently review changes across 5 dimensions with severity classification. Use for /wf-review, peer review, second opinion, or when stuck.
---

# WF Review — Cross-Model Peer Review

**Anti-Self-Review Guard:** Use the OTHER CLI. Claude→Codex, Codex→Claude. Never self-review.

## When to Ask the User (AskUserQuestion)

BEFORE invoking the other CLI, use `AskUserQuestion` to clarify:

- Review focus ambiguous → "Which dimension should I prioritize?"
- Multiple changes to review → "Review all files or specific module?"
- User said "review this" without specifics → ask scope

Format: 2-3 options with trade-off descriptions.

**Codex fallback** (no AskUserQuestion tool): output numbered options in markdown, wait for user reply.

## CLI Detection & Invocation

| Runtime | Command |
|---|---|
| Claude → Codex | `git diff \| codex exec "<5-dimension review prompt>"` |
| Codex → Claude | `git diff \| claude -p "<5-dimension review prompt>"` |
| Only one CLI | Warn user. Do NOT self-review. |

## 5 Mandatory Review Dimensions

Construct the prompt covering ALL 5:

| # | Dimension | Key Questions |
|---|-----------|---------------|
| 1 | **Correctness** | Bugs, edge cases, race conditions, null/undefined, logic flaws? |
| 2 | **Security** | Injection, auth bypass, data exposure, input validation, unsafe deps? |
| 3 | **Architecture** | Boundary violations, coupling, state ownership, interface contract breaks? |
| 4 | **Performance** | Algorithmic complexity, N+1 queries, memory leaks, unnecessary allocations? |
| 5 | **Tests** | Coverage gaps, missing edge cases, test quality, CI regressions? |

## Context

Include: `git diff` (or `git diff --cached`), relevant `Harness/` docs (architecture.md), the 5-dimension table above.

**Size guard:** diff >500 lines → warn + suggest narrower scope or split review.

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Security vuln, data loss, crash, data corruption | Must fix before merge |
| **High** | Bug, regression, spec violation, broken contract | Should fix before merge |
| **Medium** | Maintainability, duplication, test gap, perf concern | May defer with written justification |
| **Low** | Style, naming, minor optimization, nit | Optional |

## Rules

- Bash MUST invoke the other CLI — never simulate.
- Both CLIs fail → report error, don't skip.
- Raw output first, then your classified synthesis.
- Peer findings = authoritative; your classification = supplementary.

## CEO Synthesis Output

```
Review CLI: [Codex / Claude]
Dimensions: Correctness, Security, Architecture, Performance, Tests

Critical (must fix):
- [file:line] description → fix

High (should fix):
- [file:line] description → fix

Medium (may defer):
- [file:line] description → note

Low (optional):
- [file:line] description

Verdict: APPROVE / APPROVE_WITH_FIXES / REJECT
Actions: 1. ... 2. ...
```
