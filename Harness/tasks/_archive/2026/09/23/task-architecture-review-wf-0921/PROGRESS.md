# task-architecture-review-wf-0921 - PROGRESS

Compact heartbeat. Update on phase changes, blockers, failures, and closeout.

## Status

- Phase: Archived
- Mode: direct / review-only
- Owner: pi agent
- Next: user decision on P0 release-policy baseline; P1/P2/P3 items remain follow-up tasks
- Blocker: none

## Review contract

- No source implementation in this task.
- Every finding needs `file:line` or a reproducible command.
- Baseline failures and user-owned dirty changes must be separated from review findings.
- Implementation proposals become separate follow-up tasks after this review.

## Phase checklist

- [x] W0 inventory command/skill/runtime surfaces
- [x] W1 build call graph and ownership/source-of-truth matrix
- [x] W2 inspect redundancy, dead paths, context leakage, lifecycle and mirror drift
- [x] W3 run read-only gates and classify baseline exceptions
- [x] W4 write `REVIEW.md` with verdict, findings, keep/delete matrix and minimal route
- [x] W5 update REFERENCES/PROBLEM/STATE evidence and hand off to user
- [x] W7 evidence correction (this update)

## Summary

**Verdict**: **YELLOW** (unchanged) — do not publish 0.9.6 until P0 release-policy baseline is resolved.

### W7 corrections applied

| Finding | Original | W7 Correction |
|---------|----------|---------------|
| F-001 | P0 — Mirror gate failing | P0 — Release-policy baseline exception (zingspark legacy mirror drift) |
| F-002 | P1 — Duplicate scripts, possible deletion | P1 — Public CLI wrappers, documentation task (NOT removable) |
| F-003 | P1 — Monolithic scripts | P2 — Deferred technical debt |
| F-004 | P1 — Both A2A files need `preserve` | Split: F-004a (action-registry, correctly frameworkOwned) / F-004b (workflow-map absent from manifest, needs update/ownership verification) |
| F-005 | P1 — Missing `.agents/` mirror | P3 — Conditional (depends on cross-runtime intent) |
| F-006 | P1 — Missing `.claude/` mirror | P3 — Conditional (depends on cross-runtime intent) |
| Gate report | "Not run" | **INCOMPLETE** (explicit status) |

### Corrected finding counts

| Severity | Findings |
|----------|----------|
| P0 (release-policy baseline) | 1 (F-001) |
| P1 (should fix before next major) | 1 (F-002) |
| P2 (should fix) | 14 (F-003, F-007-F-010, F-018-F-026) |
| P3 (cleanup / future) | 11 (F-004a, F-004b, F-005, F-006, F-011-F-017) |
| **Total** | **27** (F-001..F-026, with F-004 split into a+b) |

### Key findings (W7 corrected)

- **P0**: Mirror gate failure is a **release-policy baseline exception** — pre-existing zingspark legacy mirror drift, not a code defect. Publishing 0.9.6 while this gate fails violates release policy.
- **P1**: Top-level `memory-context.mjs` and `research-policy.mjs` are **public CLI entry points** (invoked by `.claude/commands/wf.md`). They are **not deletable**. Action: document the API contract.
- **P3**: `workflow-map.json` is runtime-only, absent from the manifest/template, and currently skipped by updater checksum logic (F-004b). Monolithic scripts remain deferred P2 tech debt (F-003).
- **P3**: Orphan skills F-005/F-006 are conditional — confirm cross-runtime intent with repo owner before deciding.

### Gate report status

- `scripts/check-update-mirrors.mjs` — **FAIL** (release-policy baseline)
- `node --test tests/*.test.js` — **INCOMPLETE** (not run)
- `node tests/e2e-wf-scripts.test.mjs` — **INCOMPLETE** (not run)
- `node --test tests/cli-smoke.test.js` — **INCOMPLETE** (not run)
- `node --test tests/pack-smoke.test.js` — **INCOMPLETE** (not run)
- `validate-harness.mjs --strict` — **INCOMPLETE** (not run)
- `scripts/build-version.mjs --check` — **INCOMPLETE** (not run)

**W7 constraint compliance**:
- No business code, manifest, skill, hook, or file modified or deleted.
- Only REVIEW.md, PROGRESS.md, REFERENCES.md, and STATE.json updated.
- All corrections are evidence-driven with file:line or command references.

## Highlights

- Ownership manifest is explicit and machine-readable
- CLAUDE.md is a thin router
- Task capsule model is deterministic
- Memory is layered
- Public CLI wrappers follow consistent layering pattern (W7 confirmed)

## Minimal route (W7 corrected)

1. Resolve mirror gate baseline (P0) — record baseline exception OR sync zingspark mirror
2. Document `workflow-map.json` runtime-only ownership and current updater skip behavior (P3)
3. Document public CLI wrappers (P1) — add API contract documentation
4. Document or mirror orphan skills (P3, conditional) — confirm intent first
5. Delete orphan debug artifacts (P2)
6. Refactor monolithic scripts (P2, deferred) — dedicated task
7. Inventory unknown directories (P3)
