# Update Mechanism — Design

## 1. Version Tracking

### File: `Harness/.harness-version`

**Location**: `Harness/.harness-version` — a hidden JSON file inside the Harness directory. Dot-prefix signals that it is machine-managed, not user-editable.

**Why `Harness/` and not root**: The version file is a harness artifact, not a project fact. Root should stay clean for project-owned files.

**Format**:

```json
{
  "generator": "0.2.1",
  "generated": "2026-06-24T18:00:00.000Z",
  "options": ["browser-e2e"],
  "autoCheck": true,
  "checksums": {
    "CLAUDE.md": "sha256-a1b2c3d4e5f6...",
    "Harness/WF.md": "sha256-e5f6a1b2c3d4...",
    ".claude/agents/researcher.md": "sha256-..."
  }
}
```

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `generator` | string | Semver of `create-harness-vibe-coding`. From `package.json#version`. |
| `generated` | string | ISO 8601 timestamp of initial scaffold. |
| `options` | string[] | IDs of optional skills installed. |
| `autoCheck` | boolean | Auto-check for updates at WF session start. Default `true`. |
| `checksums` | object | Map of file path (POSIX) to SHA-256 hex digest. LF-normalized. |

**Why JSON**: Already used for `catalog.json` and `.claude/settings.json`. Native `JSON.parse`. Not user-editable.

**Why SHA-256**: Collision-resistant, Node `crypto.createHash('sha256')`, no dependency.

**Why semver**: npm distribution has no `.git`. `package.json#version` is canonical. Enables range comparison.

---

## 2. Update Command UX

### CLI: `npx create-harness-vibe-coding@latest update`

```
npx create-harness-vibe-coding@latest update [target-dir] [flags]
```

**Flags**:

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--check` | boolean | false | Dry-run. Reports what would change. Implies `--json`. |
| `--scope` | `core`, `skills`, `all` | `core` | Update scope. |
| `--on-conflict` | `fail`, `skip`, `backup`, `overwrite` | `fail` | Conflict policy for user-modified files. |
| `--json` | boolean | false | Machine-readable output. |
| `--yes` / `-y` | boolean | false | Skip confirmation. |

**Error codes**:

| Code | Meaning |
|------|---------|
| 0 | Success or already up to date |
| 1 | Updates available (`--check`) or generation errors |
| 2 | Network unavailable |
| 3 | Not a Harness project |

**Examples**:

```bash
npx create-harness-vibe-coding@latest update --check
npx create-harness-vibe-coding@latest update
npx create-harness-vibe-coding@latest update . --scope all --on-conflict skip -y
npx create-harness-vibe-coding@latest update ../my-project --check --json
```

### Slash Command: `/wf update`

Within a project: delegates to CLI. For `--check`: reports findings. For full update: spawns WF task `harness-update`.

### Auto-Check on Session Start

When `autoCheck` is `true`:
1. Non-blocking `update --check --json` (timeout 10s).
2. If available: brief notification. Does NOT block current task.
3. If offline: silent skip.

---

## 3. Safety & Conflict Resolution

### Three-Tier File Classification

#### TIER 1 — SAFE (overwrite if checksum matches)

Harness runtime files. Users are not expected to modify. If checksum matches → safe overwrite. If mismatch → apply `--on-conflict`.

Includes: `Harness/*.md` (protocols), `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/rules/ecc/common.md`, `.claude/settings.json`, `.claude/commands/wf.md`, `AGENTS.md`, `tests/.gitkeep`.

#### TIER 2 — PRESERVE (never touched by update)

User data files. Start as templates but designed for customization. NEVER in update scope.

Includes: `Harness/PROGRESS.md`, `Harness/tasks/**`, `Harness/memory/**`, `Harness/research/PRD.md`, `Harness/research/research-results.md`, `Harness/architecture.md`, `Harness/features/**`, `Harness/workflows/**`, root `README.md`, root `.gitignore`.

#### TIER 3 — MERGE (dual-purpose: scaffold + user content)

| File | Harness sections | User content |
|------|-----------------|--------------|
| `CLAUDE.md` | Sections 1-6 | Project-specific rules |
| `Harness/MEMORY.md` | Agent/Skill registrations | User-added registrations |
| `Harness/README.md` | Keyword Routing, Load By Task, Doc Map | User-added routing rows |

If checksum matches → safe overwrite. If mismatch → merge candidate. Never auto-overwrite. Report as "merge candidate" in plan.

### Checksum Rules

1. Read as UTF-8.
2. Normalize `\r\n` and `\r` to `\n`.
3. SHA-256 hex digest.
4. Store as `sha256-<hex>`.

### Update Summary Output

```
  updated     3   (SAFE: checksum matched, overwritten)
  merge       2   (MERGE: user-modified, needs manual review)
  created     1   (new template file)
  skipped     0   (on-conflict skip)
  backedUp    0   (on-conflict backup)
  overwritten  0   (on-conflict overwrite applied to mismatched SAFE)
  conflicts   0   (on-conflict fail)
  stale       1   (file in project but removed from template)
```

---

## 4. Update Scope Matrix

### `--scope core` (default)
Updates TIER 1 + TIER 3 (if checksum matches) + `Harness/.harness-version`. Excludes TIER 2.

### `--scope skills`
Updates only optional skills listed in `options` + their registrations (if unmodified).

### `--scope all`
Combines `core` + `skills`.

---

## 5. WF Mode Integration

### Startup Check
Non-blocking. After loading `Harness/MEMORY.md` and `Harness/README.md`, run `update --check --json` (10s timeout). Notify if available.

### Update as WF Task
1. Create `Harness/tasks/harness-update/` capsule.
2. Explore: `update --check --json`.
3. Plan: review merge candidates, choose `--on-conflict` policy.
4. Build: run `update`.
5. Review: run validator.
6. Verify: run strict validator.
7. Closeout: `context-master` re-evaluates, `memory-master` records.

### Context Re-Evaluation
After update: re-read `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`. Note changes in active task heartbeat.

### During Active Task vs Between Tasks
- Between tasks: preferred.
- During active task: warn user. Flag in heartbeat if they proceed.

---

## 6. Implementation Plan

### New Template Files
- `templates/common/.harness-version` — version file template with `{{generatorVersion}}` and `{{generatedTimestamp}}` placeholders.

### Modified Template Files
- `templates/common/CLAUDE.md` — add update check startup line.
- `templates/common/docs/README.md` — add update routing row.

### Generator Changes (`src/generator.js`)
1. `computeChecksum(content)` — LF-normalized SHA-256.
2. `buildVersionFile(vars, selectedSkills, createdFiles)` — populates checksums map.
3. `generate()` — write `.harness-version` last (captures all checksums).
4. `updateProject({ targetDir, dryRun, onConflict, scope, json })` — reads version, compares, builds plan.
5. `checkForUpdates(targetDir)` — thin wrapper, `dryRun: true`.

### CLI Changes (`src/index.js`)
1. Parse `update` positional command.
2. Parse `--check`, `--scope` flags.
3. `printUpdateResult()` with update-specific output.

### Validator Changes
- Add `Harness/.harness-version` to `required`.
- Validate JSON structure + required fields.
- Check CLAUDE.md references `.harness-version`.
- Check README.md has update routing row.

### Tests
- `tests/update-check.test.js` — checksum, version file, update plan.
- `tests/update-cli.test.js` — smoke tests for CLI flags.
- Update existing scaffold tests for `.harness-version` generation.

### Implementation Order
1. `computeChecksum()` + `buildVersionFile()` in generator
2. `.harness-version` template + `{{generatorVersion}}` var
3. Write `.harness-version` during generation
4. Update CLAUDE.md + README.md templates
5. `updateProject()` in generator
6. `update` command in CLI
7. Validator checks
8. Tests
9. Dogfood

---

## 7. Open Questions

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Section-delimited merge markers for v2? | Add `<!-- HARNESS-BEGIN/END -->` markers to templates NOW. Implement merge logic in v2. |
| 2 | Update during active WF task? | Detect active task, warn user, flag in heartbeat if forced. |
| 3 | Per-skill versioning in catalog.json? | Add optional `version` field to catalog.json entries in v2. |
| 4 | Bundled "latest known version" for offline? | No. Cannot detect newer without network. Document limitation. |
| 5 | CI-friendly exit codes? | Already designed: exit 0 = up to date, exit 1 = updates available. |
| 6 | npm vs GitHub releases? | npm only for v1. GitHub in future. |
| 7 | Dogfood update of this repo? | Yes. After release, run `update` in this repo to validate end-to-end. |
