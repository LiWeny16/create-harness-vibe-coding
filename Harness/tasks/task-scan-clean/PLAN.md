# scan-clean — PLAN

Task-level implementation plan and evidence. Main agent writes after second planning; implementer reads before coding.

## Goal

Add `Harness/scripts/scan-clean.mjs` and integrate it as the final phase of `/wf-update`. The script detects dead harness files (tracked locally in `.harness-version` but removed from the remote template) and cleans them up, preventing technical debt accumulation after updates.

## Acceptance Criteria

- [x] `node Harness/scripts/scan-clean.mjs` runs without --clean and reports categories
- [x] `node Harness/scripts/scan-clean.mjs --json` outputs valid machine-readable JSON
- [x] `node Harness/scripts/scan-clean.mjs --clean` deletes only DEAD files (tracked locally, not in remote, not PRESERVE)
- [x] Deletes empty directories left behind after file cleanup
- [x] PRESERVE files (memory, tasks, research, README, PROGRESS, architecture) are NEVER deleted
- [x] `node Harness/scripts/validate-harness.mjs` passes after changes
- [x] `.claude/skills/wf-update/SKILL.md` documents scan & clean as final phase
- [x] `Harness/.harness-version` includes checksum for scan-clean.mjs

## Scope

Allowed write set:
- `Harness/scripts/scan-clean.mjs` (NEW — dead file scanner & cleaner)
- `.claude/skills/wf-update/SKILL.md` (EDIT — add scan & clean step)
- `Harness/.harness-version` (EDIT — add scan-clean.mjs checksum)

Forbidden:
- Any changes to wf-update-check.mjs (separate concern)
- Any changes to validate-harness.mjs
- Any other files

## Architecture

```
wf-update flow (current):
  check → resolve conflicts → apply → validate

wf-update flow (after):
  check → resolve conflicts → apply → scan → clean → validate
```

### Dead File Detection Algorithm

1. Read local `.harness-version` → `localChecksums`
2. Fetch remote `.harness-version` → `remoteChecksums`
3. DEAD files = keys in `localChecksums` NOT in `remoteChecksums`, AND NOT matching PRESERVE patterns
4. ORPHAN files = on disk in framework dirs, NOT in either checksum set

### Safety: PRESERVE patterns (never delete)

Same patterns as wf-update-check.mjs: Harness/PROGRESS.md, Harness/tasks/, Harness/memory/, Harness/research/PRD.md, Harness/research/research-results.md, Harness/architecture.md, README.md, .gitignore, package.json, package-lock.json.

## Subagent Dispatch (W2 — Implementation)

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| impl-scan-clean | Serial Write | wf-update-check.mjs, .harness-version, validate-harness.mjs, templates/common file listing | Harness/scripts/scan-clean.mjs | Pending |
| impl-skill-update | Serial Write | wf-update/SKILL.md, scan-clean.mjs (after impl-scan-clean) | .claude/skills/wf-update/SKILL.md | Pending |
| impl-version-update | Serial Write | .harness-version, scan-clean.mjs (after impl-scan-clean) | Harness/.harness-version | Pending |

Note: impl-scan-clean runs first (creates new file). impl-skill-update and impl-version-update depend on scan-clean.mjs existing (need the file path and checksum), but are otherwise independent of each other → parallel after impl-scan-clean.

## Subagent Synthesis

### 2026-06-26 — Scaffold back-port investigation (3 parallel explorers)

Agents used: 3 general-purpose explorers (script-gap map, harnessDest audit, checksum-build trace).

Findings accepted:
1. **scan-clean.mjs is UNTRACKED in git** — exists only in working tree. Must `git add` or it is lost.
2. **Script-driven update system never back-ported to scaffold.** `templates/common/scripts/` has ONLY `validate-harness.mjs`. Missing: `wf-update-check.mjs`, `wf-remove.mjs`, `scan-clean.mjs`. Commit `ee9bdd3` added them to dogfood `Harness/scripts/` only.
3. **Generator bug (latent):** `harnessDest()` (src/generator.js:21) maps only `scripts/validate-harness.mjs` by exact match; any other `scripts/*` falls through to project ROOT. Fix: replace L21 with `if (file.startsWith('scripts/')) return ` + Harness/${file} + `;` — preserves validate-harness behavior, breaks no tests (no manifest/snapshot test exists).
4. **Scaffold `wf-update` SKILL is the OLD AI-driven version** — no Scan & Clean section, no script refs. Scaffold also has NO wf-remove skill/command at all.
5. **Checksum-build/release step does NOT exist.** Published `templates/common/.harness-version` = `{{placeholders}}` + `checksums:{}`. No CI, no npm script, no generator code renders it. `isTemplate()` guard in wf-update-check.mjs + scan-clean.mjs makes the remote permanently bail. `buildVersionFile()` was designed (update-mechanism/DESIGN.md §6) but never implemented. Dogfood's 53 checksums were hand-maintained by an agent.

Conflicts: Explorer-1's premise "broken scaffold references" was FALSE — scaffold is internally self-consistent (just stale); the missing-script refs all live in dogfood runtime, which is not shipped.

Decisions: PENDING USER SCOPE DECISION (see below). Safe-to-do-now regardless of scope: (a) `git add` scan-clean.mjs, (b) harnessDest one-line fix.

Residual risk: Without the checksum-build step (finding 5), any update/scan feature shipped to the scaffold is INERT for end users. This is the true blocker behind the user's original "clean up dead files on update" request.

## Decision: Full back-port + checksum build (user-approved 2026-06-26)

### Checksum semantics (locked by placeholder audit)
- All 9 placeholder files are PRESERVE-tier or explanatory text. NO SAFE file contains `{{projectName|generatorVersion|generatedTimestamp}}`. So `renderTemplate` leaves SAFE files verbatim → checksum(raw template) == checksum(generated file). Mechanism is sound.
- **Checksum rule**: include a dest path IFF it does NOT match PRESERVE_PATTERNS AND is not `.harness-version`. (Same PRESERVE_PATTERNS as wf-update-check.mjs.) This correctly includes validate-harness.mjs (its `{{TOKEN}}` is only in --help text, file is SAFE) and excludes PRD.md etc.
- Value = `sha256-` + LF-normalized hex of content. Keys = harnessDest() POSIX paths.

### Two consumers of one shared `computeChecksums()` helper (DRY)
1. `scripts/build-version.mjs` (NEW, repo-level) → writes `templates/common/.harness-version` with real `generator` (from package.json), real `generated` (build time), real `checksums`. NO placeholders. This is the REMOTE update source. Run at release.
2. `src/generator.js generate()` → writes each project's local `Harness/.harness-version` with checksums computed over the files it actually generated (incl. optional skills), version = pkg.version, generated = scaffold time. The generator COMPUTES local; it does NOT copy the template's .harness-version verbatim.

### Write-set & Dispatch Table

**Wave 1 (parallel, disjoint files):**
| Worker | Files | Concern |
|--------|-------|---------|
| W1 back-port-scripts | templates/common/scripts/{wf-update-check,wf-remove,scan-clean}.mjs | Verbatim copy from Harness/scripts/ (mechanical, bundled — no authoring) |
| W2 wf-update-port | templates/common/.claude/skills/wf-update/SKILL.md + .claude/commands/wf-update.md | Replace stale AI-driven with script-driven (incl. Scan & Clean) |
| W3 wf-remove-port | templates/common/.claude/skills/wf-remove/SKILL.md + .claude/commands/wf-remove.md | NEW — port from dogfood |
| W4 generator | src/generator.js | harnessDest scripts/ fix + export computeChecksums + compute local .harness-version |

**Wave 2 (after W1+W4):**
| Worker | Files | Concern |
|--------|-------|---------|
| W5 build-script | scripts/build-version.mjs + package.json | NEW build:version; reuses computeChecksums; then RUN it to populate template .harness-version |

**Wave 3 (after W5):**
| Worker | Files | Concern |
|--------|-------|---------|
| W6 validator | templates/common/scripts/validate-harness.mjs + Harness/scripts/validate-harness.mjs | Require new scripts; add wf-remove skill to commonSkills |
| W7 tests | tests/*.test.* | Cover build:version output + harnessDest scripts mapping + .harness-version population |

### Verification path
- `node scripts/build-version.mjs` populates template .harness-version (real checksums, no placeholders)
- `npm test` green
- Generate a throwaway project to a tmp dir → confirm scripts land in Harness/scripts/, local .harness-version has real checksums
- `git add` scan-clean.mjs (currently UNTRACKED) and all new template files

### DEEPER BUG found empirically (2026-06-26, post-W4)
Generated a real project. Local `.harness-version` keys files by DEST path (`Harness/WF.md`, `Harness/scripts/scan-clean.mjs`). But `wf-update-check.mjs` fetches `SOURCE_BASE + key` = `templates/common/Harness/WF.md` → **404** (template has it at `docs/harness/WF.md`). Affects ALL harnessDest-remapped files (~20+). Verified: CLAUDE.md & .claude/* fetch OK (dest==template); Harness/WF.md & Harness/scripts/scan-clean.mjs 404.
- **scan-clean (original ask) UNAFFECTED** — compares checksum KEYS only, never fetches content.
- **Fix**: remote `.harness-version` carries `sources` map {destPath: templateRelPath}. build-version emits it. wf-update-check fetches `SOURCE_BASE + (sources[file] ?? file)`. Local needs no sources.
- W5 = generator exports + scripts/build-version.mjs + package.json. W6 (parallel) = fetch fix in BOTH wf-update-check copies. CEO runs build-version after. W7 validator, W8 tests.

### Baseline test state (verified by stash/compare)
58 tests, 50 pass, 8 fail at CLEAN HEAD. Same 8 after Wave 1 → ZERO regressions. The 8 are pre-existing dogfood-repo issues (missing optional wf-browser/browser-use skill files; this repo's own architecture.md/PROGRESS.md), unrelated to scaffold update mechanism.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| scan-clean.mjs runs (report mode) | ✅ | Correctly bails when remote has {{placeholders}} (dev repo); works on real projects with build:version |
| scan-clean.mjs --json output | ✅ | Valid JSON output with status/dead/orphan/emptyDirs/summary |
| scan-clean.mjs --clean | ✅ | Interactive y/N prompt, safety checks (PRESERVE, symlink, traversal), writes updated .harness-version |
| Empty dir cleanup | ✅ | Removes empty parent dirs after file deletion, walks up to ROOT |
| validate-harness.mjs passes | ✅ | Both dogfood + template validators pass |
| wf-update SKILL.md updated | ✅ | New Scan & Clean section (lines 53-65), script-driven flow with step 6 |
| template .harness-version populated | ✅ | 44 checksums, 58 sources entries, real semver, no {{placeholders}} |
| harnessDest scripts/ fix | ✅ | `scripts/` prefix rule maps all scripts to `Harness/scripts/` |
| build-version script | ✅ | `npm run build:version` populates checksums + sources |
| wf-update-check fetch fix | ✅ | Uses `remotePath(u.file)` resolving via sources map with key fallback |
| generator tests | ✅ | 3 new tests pass: harnessDest mapping, build-version output, .harness-version population |
| MEMORY.md wf-remove registration | ✅ | Both dogfood + template copies updated |
| No regressions | ✅ | 61 tests / 53 pass / 8 fail (same 8 pre-existing, zero new) |
| All 32 files staged | ✅ | git status clean for planned scope |
