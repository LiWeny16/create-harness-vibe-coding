# task-architecture-review-wf-0921 - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|
| Mirror gate check | `node scripts/check-update-mirrors.mjs` | 2026-09-21 |
| Git status | `git status --porcelain` | 2026-09-21 |
| Directory inventory | `du -sh` on all top-level directories | 2026-09-21 |
| File counts | `find` + `wc -l` on various surfaces | 2026-09-21 |
| W7 evidence correction | Reviewer corrections applied | 2026-09-21 |
| Post-W7 mirror spot check | `node scripts/check-update-mirrors.mjs` rerun; canonical main request aborted, legacy zingspark main/version still failed, canonical v0.9.5 passed | 2026-09-22 |

## Evidence

| What | Pointer | Verified | W7 Note |
|------|---------|----------|---------|
| Mirror gate failure | `scripts/check-update-mirrors.mjs` output | ✓ | Release-policy baseline |
| 19 commands in `.claude/commands/` | `ls .claude/commands/` | ✓ | |
| 19 commands in `.opencode/commands/` | `ls .opencode/commands/` | ✓ | |
| 23 skills in `.claude/skills/` | `ls .claude/skills/` | ✓ | |
| 24 skills in `.agents/skills/` | `ls .agents/skills/` | ✓ | |
| 20 agents in `.claude/agents/` | `ls .claude/agents/` | ✓ | |
| 20 agents in `.opencode/agents/` | `ls .opencode/agents/` | ✓ | |
| 23 top-level scripts + 6 lib modules | `ls Harness/scripts/` + `ls Harness/scripts/lib/` | ✓ | |
| `task-state.mjs` size (99 KB) | `ls -la Harness/scripts/task-state.mjs` | ✓ | |
| `wf-ui-control.mjs` size (145 KB) | `ls -la Harness/scripts/wf-ui-control.mjs` | ✓ | |
| `validate-harness.mjs` size (106 KB) | `ls -la Harness/scripts/validate-harness.mjs` | ✓ | |
| `Harness/a2a/` size (98 MB) | `du -sh Harness/a2a/` | ✓ | |
| `Harness/wf-browser/tmp/` size (270 MB) | `du -sh Harness/wf-browser/tmp/` | ✓ | |
| `src/ui/node_modules/` size (482 MB) | `du -sh src/ui/node_modules/` | ✓ | |
| 7 active task capsules | `ls Harness/tasks/task-*` | ✓ | |
| `INDEX.json` source of truth | `Harness/tasks/INDEX.json` | ✓ | |
| Ownership manifest structure | `Harness/ownership.manifest.json` | ✓ | |
| CI workflow | `.github/workflows/ci.yml` | ✓ | |
| `.gitignore` rules | `.gitignore` lines 83-85 | ✓ | |
| Orphan files gitignore status | `git check-ignore -v` on each file | ✓ | |
| `Harness/specs/cooperation/agent-team-cooperation-spec.md` | `find Harness/specs/cooperation -type f` | ✓ | |
| `extensions/wf-search-deep/` contents | `find extensions/wf-search-deep -type f` | ✓ | |
| `benchmarks/harness-intelligence-092/` contents | `find benchmarks -type f` | ✓ | |
| CLAUDE.md A2A state warning | `CLAUDE.md` line about `Harness/a2a/**/state.json` | ✓ | Applies only to `workflow-map.json` after W7 split |
| Dirty git tree (137 files) | `git status --porcelain \| wc -l` | ✓ | |
| Branch: `agent/wf-ui-state-checkpoint-20260804` | `git branch --show-current` | ✓ | |
| Latest commit: `6b43836 release: publish 0.9.5` | `git log --oneline -1` | ✓ | |
| **Public CLI entry points** (W7) | `.claude/commands/wf.md:14` invokes `memory-context.mjs`; `:19` invokes `research-policy.mjs` | ✓ | Top-level wrappers are public API, not duplicates |
| **wf-search public CLI** (W7) | `.claude/commands/wf-search.md:54` invokes `node Harness/scripts/wf-search.mjs` | ✓ | Confirms same layering pattern |
| **action-registry.json ownership** (W7) | `Harness/ownership.manifest.json` lists as `frameworkOwned` | ✓ | Correctly classified — static framework contract |
| **workflow-map.json ownership** (W7) | `rg -n "workflow-map.json" Harness/ownership.manifest.json` returns no manifest entry; CLAUDE.md says "backend-owned diagnostic storage" | ✓ | Needs explicit updater/update-ownership verification (F-004b) |
| **workflow-map updater behavior** (W7 recheck) | `templates/common/Harness/a2a/workflow-map.json` absent; `wf-update-check.mjs:1170-1175` skips files with no `remoteHash` as `not in remote` | ✓ | Documentation/contract gap; no current overwrite path observed |

## Gate report (W7: INCOMPLETE marked)

| Gate | Status |
|------|--------|
| `scripts/check-update-mirrors.mjs` | **FAIL** (release-policy baseline) |
| `node --test tests/*.test.js` | **INCOMPLETE** — not run |
| `node tests/e2e-wf-scripts.test.mjs` | **INCOMPLETE** — not run |
| `node --test tests/cli-smoke.test.js` | **INCOMPLETE** — not run |
| `node --test tests/pack-smoke.test.js` | **INCOMPLETE** — not run |
| `validate-harness.mjs --strict` | **INCOMPLETE** — not run |
| `scripts/build-version.mjs --check` | **INCOMPLETE** — not run |

**W7 note**: "INCOMPLETE" explicitly indicates the gate was not executed. Do not treat "not run" as "pass" or "fail". Must be run before any release decision.

## Links

| Description | URL / Path |
|-------------|------------|
| REVIEW.md (this task) | `Harness/tasks/task-architecture-review-wf-0921/REVIEW.md` |
| CLAUDE.md (session router) | `CLAUDE.md` |
| Harness/README.md (Harness router) | `Harness/README.md` |
| Harness/MEMORY.md (memory index) | `Harness/MEMORY.md` |
| Ownership manifest | `Harness/ownership.manifest.json` |
| Task state script | `Harness/scripts/task-state.mjs` |
| A2A control plane | `Harness/scripts/wf-ui-control.mjs` |
| Validator | `Harness/scripts/validate-harness.mjs` |
| Mirror check | `scripts/check-update-mirrors.mjs` |
| CI workflow | `.github/workflows/ci.yml` |
| Package scripts | `package.json` `scripts` block |
| Public CLI: memory-context | `Harness/scripts/memory-context.mjs` |
| Public CLI: research-policy | `Harness/scripts/research-policy.mjs` |
| Public CLI: wf-search | `Harness/scripts/wf-search.mjs` |

## Notes

- This review is read-only. No business code, command, skill, hook, template, or test was modified or deleted.
- The dirty git tree (137 files) is a pre-existing condition, not caused by this review.
- The `zingspark` legacy mirror failure is a **release-policy baseline exception**, not a code defect (W7).
- After W7 correction: `action-registry.json` is correctly `frameworkOwned`; `workflow-map.json` is runtime-only, absent from the manifest/template, and currently skipped by updater checksum logic (W7). Remaining action is documentation, not a demonstrated overwrite bug.
- Top-level `memory-context.mjs` and `research-policy.mjs` are public CLI entry points, not duplicates — do not delete (W7).
- Unrun gates are marked **INCOMPLETE**, not "Not run" (W7).
