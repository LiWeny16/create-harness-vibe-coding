# scan-clean — PROGRESS

Task-level progress and heartbeat. Main agent updates; subagents read only.

## Current Goal

Add scan & clean to `/wf-update`, full scaffold back-port, and checksum build step so the update mechanism actually works for end users. **DONE.**

## Phase

Current: CLOSEOUT (verified, 32 files staged)

## Heartbeat

Last beat: 2026-06-26
Current phase: CLOSEOUT
Current blocker: none
Next beat trigger: post-commit — re-run build:version after release to keep checksums fresh
Failure count: 0
Recovery action: none

## Tasks

| # | Task | Owner | Verify | Status |
|---|------|-------|--------|--------|
| 1 | Create Harness/scripts/scan-clean.mjs | impl-scan-clean | node check ✓ | Done |
| 2 | Update wf-update SKILL.md (dogfood) | impl-skill-update | diff review ✓ | Done |
| 3 | Register in .harness-version (dogfood) | impl-version-update | checksum verify ✓ | Done |
| 4 | Codify explicit-invocation fan-out rule (6 files) | 3 parallel implementers | validator ✓ | Done |
| 5 | Record user correction in memory | CEO | file exists ✓ | Done |
| 6 | Explorers: scaffold gap map, harnessDest audit, checksum-build trace | 3 parallel explorers | synthesis ✓ | Done |
| 7 | W1: back-port 3 scripts to scaffold | impl-scripts-backport | syntax check ✓ | Done |
| 8 | W2: port script-driven wf-update SKILL+command | impl-skill-port | frontmatter ✓ | Done |
| 9 | W3: port wf-remove skill+command to scaffold | impl-wfremove-port | frontmatter ✓ | Done |
| 10 | W4: generator fixes (harnessDest + checksums) | impl-generator | tests ✓ | Done |
| 11 | W5: build-version script + generator exports | impl-build-version | output ✓ | Done |
| 12 | W6: wf-update-check fetch fix (sources map) | impl-fetch-fix | syntax check ✓ | Done |
| 13 | W7: validator update (new scripts + wf-remove) | impl-validator | validators pass ✓ | Done |
| 14 | MEMORY.md wf-remove registration (both copies) | CEO | validators pass ✓ | Done |
| 15 | W8: tests (harnessDest, build-version, .harness-version) | impl-tests | 3 new pass ✓ | Done |
| 16 | git stage all changes | CEO | 32 files staged ✓ | Done |

## Agent Handoffs

| Agent | Role | Result |
|-------|------|--------|
| impl-scan-clean | implementer | 457-line scan-clean.mjs |
| impl-skill-update | implementer | wf-update SKILL with Scan & Clean |
| impl-version-update | implementer | scan-clean checksum registered |
| 3 fan-out codifiers | implementers | WF.md, WF-MAX.md, SKILL.md hardened |
| 3 explorers | general-purpose | Scaffold gap map + harnessDest bug + checksum gap |
| W1 scripts back-port | implementer | 3 scripts → templates/common/scripts/ |
| W2 wf-update port | implementer | SKILL + command → scaffold |
| W3 wf-remove port | implementer | SKILL + command → scaffold |
| W4 generator | implementer | harnessDest fix + computeChecksums + deferred .harness-version |
| W5 build-version | implementer | scripts/build-version.mjs + package.json script |
| W6 fetch fix | implementer | remotePath(sources) in wf-update-check ×2 |
| W7 validator | implementer | wf-remove in commonSkills + 4 new required files |
| W8 tests | implementer | 3 new tests (harnessDest, build:version, .harness-version) |

## Verification Evidence

- `node Harness/scripts/validate-harness.mjs` — ✅ PASSED (dogfood)
- `templates/common/scripts/validate-harness.mjs` — ✅ PASSED (scaffold)
- `npm test` — 61 tests / 53 pass / 8 fail (same 8 pre-existing, zero new failures)
- `template .harness-version` — 44 checksums, 58 sources, real semver, no {{placeholders}}
- `node scripts/build-version.mjs` — populates correctly
- `src/generator.js` — harnessDest scripts/ prefix fix verified
- `templates/common/scripts/` — contains all 4 scripts (validate-harness, wf-update-check, wf-remove, scan-clean)
- Both validators check for new scripts + wf-remove skill
- Both MEMORY.md copies register wf-remove
- 32 files staged for commit

## Scope Delivered

| What | Where |
|------|-------|
| scan-clean.mjs | Dogfood + scaffold (both copies) |
| wf-update Script-driven SKILL + command | Scaffold (replaced stale AI-driven) |
| wf-remove SKILL + command | Scaffold (NEW) |
| harnessDest scripts/ prefix fix | src/generator.js |
| Local .harness-version checksums | src/generator.js (computeChecksums, deferred write) |
| Remote .harness-version builder | scripts/build-version.mjs + npm run build:version |
| sources map (dest→template path) | Remote .harness-version + wf-update-check fetch fix |
| Validator coverage | Both validators know about new scripts + wf-remove |
| MEMORY registrations | Both copies register wf-remove |
| Fan-out mandate codification | WF.md, WF-MAX.md, wf-max SKILL.md (all copies) |
| Tests | 3 new tests in generator.test.js (harnessDest, build-version, .harness-version) |
| User correction memory | Explicit invocation always fans out subagents |
