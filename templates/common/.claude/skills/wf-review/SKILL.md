---
name: wf-review
description: Risk-based, method-neutral cross-review with evidence-backed findings and controller adjudication.
---

# WF Review

`wf-review` coordinates an evidence-first review of a pinned change. Its review
strategy is method-neutral: it does not require or prohibit a particular CLI,
runtime, model, or invocation method. Reviewers report evidence-backed
suggestions; the controller owns the final finding decisions and verdict.

## Invocation

- Claude Code: use `/wf-review [focus]` or select the `wf-review` skill.
- Codex: use `$wf-review` or `/skills` then choose `wf-review`.
- OpenCode: use `/wf-review [focus]`; the `.opencode/commands/wf-review.md`
  wrapper routes here.

## Authority

The controller pins the review subject and owns scope, accepted/rejected findings,
fixes, release claims, and user-facing recommendations. Reviewer output is
hypothesis and evidence, not approval or an automatic verdict. Do not make a
review finding disappear merely because another reviewer did not report it.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`:
use the changed-file list, pinned diff/revision, acceptance criteria, validation
evidence, and only the relevant surrounding code. Avoid unrelated history, full
transcripts, and unused tool schemas.

## Method-neutral review contract

1. Pin the exact change under review. Keep it unchanged while findings are being
   evaluated; if it changes, identify which conclusions need a fresh pass.
2. Select review dimensions and reviewer effort by risk. Use one focused pass for
   narrow, low-risk changes; distinct independent lenses for ordinary changes;
   add further lenses only for broad, high-impact, or security-sensitive scope.
   Do not add reviewers for dimensions that are not materially in scope.
3. **Independent first pass:** provide reviewers the same core evidence packet
   and distinct questions, but do not share other reviewers' findings
   until their initial reports are complete. This reduces anchoring. If only one
   review perspective is available, report that honestly; do not call it
   cross-review.
4. Require structured, evidence-backed findings. Severity reflects likely
   impact and reachability, not reviewer confidence or the number of reviewers
   who agree. A finding is not actionable merely because it sounds plausible.
5. Deduplicate by underlying failure mechanism, preserving distinct evidence
   and affected paths when one root cause has multiple symptoms.
6. **Targeted challenge:** run one bounded pass for material, high-impact,
   disputed, or weakly evidenced candidates. A reviewer who did not originate the finding
   should try to refute it using the pinned source, contract, and available test
   evidence. The challenge response must explain its reasoning; it is not a vote.
   The controller owns any additional review and prevents unbounded reviewer
   recursion or debate.
7. Verify each material finding against the cited source and relevant contract
   or test. Keep unresolved items visible with the evidence gap; do not silently
   convert uncertainty into PASS.

### Finding evidence schema

Each candidate finding should include:

```text
Finding ID:
Severity: Critical | High | Medium | Low
Location: changed file and line/range when available
Affected AC / contract / invariant:
Claim:
Concrete failure scenario and reachability:
Evidence: source path, relevant call path, test, or observed behavior
Verification: reproduced | source-verified | not verified (explain)
Confidence: high | medium | low (separate from severity)
```

Do not report formatting-only advice or unsupported claims as defects. If a
finding has no exact line, identify the narrowest relevant location and explain
why. If verification is unavailable, label that limitation explicitly.

### Controller adjudication

Classify each deduplicated candidate as:

- **Confirmed** — the pinned source and relevant contract, or a reproducible
  check, support the failure claim.
- **Rejected** — evidence shows the claimed path is unreachable, guarded, already
  handled, or otherwise not a defect; record the reason.
- **Unresolved** — available evidence cannot establish or refute the claim; keep
  the missing evidence and remaining risk explicit.
- **Duplicate** — merge into the root-cause finding and retain any distinct
  affected paths or supporting evidence.

Do not use a majority vote as the acceptance rule. A single evidence-confirmed
Critical or High finding remains actionable even if other reviewers missed it or
disagree. Agreement can be useful corroboration, but it cannot replace source or
test evidence.

### Review verdict

- **PASS** — relevant coverage completed; no confirmed Critical/High findings and
  no unresolved material risk.
- **PASS_WITH_NOTES** — no confirmed Critical/High findings; remaining confirmed
  Medium/Low findings or low-impact uncertainties are listed with disposition.
- **FAIL** — at least one confirmed Critical/High finding remains open.
- **INCOMPLETE** — a material candidate remains unresolved or a necessary review
  dimension was unavailable, timed out, or not covered. Report the coverage gap;
  do not treat a missing reviewer result as PASS.

The controller may choose any suitable way to obtain review perspectives. This
contract defines evidence, independence, bounded challenge, and adjudication—not
the execution mechanism.

## Review dimensions

Consider correctness and edge cases, security, architecture/contracts,
performance/resource behavior, tests/regressions, and acceptance-criteria
compliance. Select only dimensions relevant to the reviewed change and explain
material coverage gaps.

## Reviewer packet

Provide the pinned diff/revision, changed-file list, task acceptance criteria,
validation already performed, relevant context, and the assigned review lens.
Require read-only review and the finding evidence schema above. Reviewers do not
edit files, mutate Git state, expand their own panel, or invoke recursive review.
A timed-out or malformed report is unavailable evidence, never an implicit pass.

## Context

Include `Harness/project/architecture.md` when architecture is in scope and the
relevant task plan or acceptance criteria. If the review scope is too large to
inspect coherently, identify the specific limitation and ask for a narrower
scope rather than claiming complete coverage.
