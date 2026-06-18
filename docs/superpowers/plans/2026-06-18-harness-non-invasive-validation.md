# Harness Non-Invasive Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scaffold safe for existing projects, expose optional workflow skills, and add P0 automated validation evidence.

**Architecture:** Keep the generator as a small file-planning and copy engine. Do not add a remote marketplace or dependency installer; optional skills are local templates selected by CLI flags. Validation starts with deterministic Node smoke tests before broader fixture projects.

**Tech Stack:** Node.js ESM, built-in `node:test`, `fs`, `path`, `child_process`, existing `@clack/prompts` and `picocolors`.

---

## Requirements

- Existing projects must not be silently overwritten.
- CLI must support dry-run planning and readable help for agents.
- Optional skills/workflows must be selected explicitly with `--with` or `--preset`.
- Default `npx create-harness-vibe-coding my-app -y` behavior remains compatible for empty targets.
- P0 tests must prove help output, scaffold generation, existing-project conflict behavior, dry-run behavior, optional catalog behavior, and package contents.
- README and generated bootstrap docs must explain agent-safe usage.

## File Structure

- Modify `src/generator.js`: add planning, conflict handling, dry-run, optional template copy, and structured result summaries.
- Modify `src/index.js`: parse new flags, print help/list-options, pass options into `generate()`, and print result summaries.
- Modify `src/prompts.js`: expose interactive conflict/options helpers only if the implementer needs them; keep non-interactive first.
- Modify `package.json`: add `test`, `test:smoke`, and `pack:smoke` scripts using Node.
- Create `tests/generator.test.js`: unit tests for generator plan/write behavior.
- Create `tests/cli-smoke.test.js`: CLI integration smoke tests.
- Create `tests/pack-smoke.test.js`: npm pack content smoke.
- Create `templates/optional/catalog.json`: local optional workflow catalog.
- Create optional skill/workflow template files under `templates/optional/`.
- Modify `templates/common/SETUP.md`: add existing-project bootstrap sequence.
- Modify `templates/common/docs/README.md`: add existing-project and workflow routing.
- Modify `templates/common/docs/harness/extension.md`: add non-invasive merge/registration rules.
- Modify `templates/common/scripts/validate-harness.mjs`: validate optional skill/workflow registration when present.
- Modify `README.md`: document existing-project use, dry-run, conflict strategies, optional catalog, and verification commands.

---

### Task 1: Non-Invasive Generator Core

**Files:**
- Modify: `src/generator.js`
- Test: `tests/generator.test.js`

- [ ] **Step 1: Write failing tests for safe conflict behavior**

Create `tests/generator.test.js` with tests equivalent to:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from '../src/generator.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-generator-'));
}

test('dry run returns planned creates without writing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'app');
  const result = generate({ projectName: 'app', targetDir, dryRun: true });

  assert.equal(result.success, true);
  assert.equal(fs.existsSync(targetDir), false);
  assert.ok(result.plan.create.includes('CLAUDE.md'));
  assert.equal(result.summary.created, 0);
});

test('default conflict policy fails before overwriting existing files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\\n');

  const result = generate({ projectName: 'legacy', targetDir });

  assert.equal(result.success, false);
  assert.match(result.errors.join('\\n'), /conflict/i);
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\\n');
});

test('skip conflict policy preserves existing files and creates missing harness files', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\\n');

  const result = generate({ projectName: 'legacy', targetDir, onConflict: 'skip' });

  assert.equal(result.success, true);
  assert.ok(result.plan.skip.includes('CLAUDE.md'));
  assert.equal(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), 'legacy rules\\n');
  assert.ok(fs.existsSync(path.join(targetDir, 'docs', 'harness', 'PLAN.md')));
});

test('backup conflict policy keeps original and writes template file', () => {
  const root = tmpdir();
  const targetDir = path.join(root, 'legacy');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'CLAUDE.md'), 'legacy rules\\n');

  const result = generate({ projectName: 'legacy', targetDir, onConflict: 'backup' });

  assert.equal(result.success, true);
  assert.ok(result.plan.backup.includes('CLAUDE.md'));
  assert.ok(fs.existsSync(path.join(targetDir, 'CLAUDE.md.harness-backup')));
  assert.match(fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8'), /# CLAUDE\\.md/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/generator.test.js`

Expected: FAIL because `generate()` does not accept `dryRun`, `onConflict`, or return `plan`.

- [ ] **Step 3: Implement minimal planning and conflict policies**

Update `src/generator.js` so `generate()` accepts:

```js
generate({
  projectName,
  targetDir,
  dryRun = false,
  onConflict = 'fail',
  withOptions = [],
  preset = undefined,
})
```

Required behavior:

- Build a plan before writing.
- Plan buckets: `create`, `skip`, `overwrite`, `backup`, `conflict`, `mkdir`.
- Valid conflict policies: `fail`, `skip`, `backup`, `overwrite`.
- Unknown policies return `{ success: false, errors: [...] }`.
- `dryRun` returns success if the only blockers are normal writes; it never writes files or directories.
- Default `fail` returns failure when existing files conflict and writes nothing.
- `skip` preserves existing files and writes missing files.
- `backup` renames existing file to `<name>.harness-backup`, then writes the template.
- `overwrite` writes the template over existing files only when explicit.
- Do not implement smart merge in this task.

- [ ] **Step 4: Run generator tests**

Run: `node --test tests/generator.test.js`

Expected: PASS.

---

### Task 2: CLI Flags And Agent Help

**Files:**
- Modify: `src/index.js`
- Modify: `src/prompts.js`
- Modify: `README.md`
- Test: `tests/cli-smoke.test.js`

- [ ] **Step 1: Write failing CLI smoke tests**

Create `tests/cli-smoke.test.js` with tests equivalent to:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const bin = path.resolve('bin/create-harness-vibe-coding.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-'));
}

test('--help documents existing-project flags and optional skills', () => {
  const output = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(output, /--dry-run/);
  assert.match(output, /--on-conflict/);
  assert.match(output, /--with/);
  assert.match(output, /--preset/);
  assert.match(output, /--list-options/);
});

test('--dry-run prints plan and does not create target', () => {
  const root = tmpdir();
  const target = path.join(root, 'dry-app');
  const output = execFileSync(process.execPath, [bin, 'dry-app', target, '-y', '--dry-run'], { encoding: 'utf8' });

  assert.match(output, /Dry run/i);
  assert.match(output, /create/i);
  assert.equal(fs.existsSync(target), false);
});

test('existing project default conflict exits non-zero and preserves file', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\\n');

  const result = spawnSync(process.execPath, [bin, 'legacy', target, '-y'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\\n${result.stderr}`, /conflict/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\\n');
});

test('existing project can opt into skip conflicts', () => {
  const root = tmpdir();
  const target = path.join(root, 'legacy');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'legacy\\n');

  const output = execFileSync(process.execPath, [bin, 'legacy', target, '-y', '--on-conflict', 'skip'], { encoding: 'utf8' });

  assert.match(output, /skipped/i);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'legacy\\n');
  assert.ok(fs.existsSync(path.join(target, 'scripts', 'validate-harness.mjs')));
});
```

- [ ] **Step 2: Run CLI tests to verify they fail**

Run: `node --test tests/cli-smoke.test.js`

Expected: FAIL because the CLI does not expose the new flags.

- [ ] **Step 3: Implement CLI parsing and output**

Update `src/index.js`:

- Parse `--dry-run`.
- Parse `--on-conflict <fail|skip|backup|overwrite>` and `--on-conflict=<value>`.
- Parse `--with <id,id>` and `--with=<id,id>`.
- Parse `--preset <name>` and `--preset=<name>`.
- Parse `--list-options`.
- Keep `-y/--yes` behavior.
- Update help with existing-project examples and agent/CI examples.
- On `--list-options`, print optional catalog ids and presets, then exit 0.
- When generation fails, print errors and exit 1.
- Print summary counts for created, skipped, backed up, overwritten, conflicts, and dry-run plan.

Update `src/prompts.js` only if interactive mode needs a conflict strategy prompt. Keep defaults conservative.

- [ ] **Step 4: Run CLI smoke tests**

Run: `node --test tests/cli-smoke.test.js`

Expected: PASS.

---

### Task 3: Optional Skills And Workflow Catalog

**Files:**
- Create: `templates/optional/catalog.json`
- Create: `templates/optional/skills/browser-e2e/.claude/skills/browser-e2e/SKILL.md`
- Create: `templates/optional/skills/browser-e2e/docs/workflows/browser-e2e.md`
- Create: `templates/optional/skills/ui-ux-review/.claude/skills/ui-ux-review/SKILL.md`
- Create: `templates/optional/skills/ui-ux-review/docs/workflows/ui-ux-review.md`
- Create: `templates/optional/skills/github-pr-review/.claude/skills/github-pr-review/SKILL.md`
- Create: `templates/optional/skills/github-pr-review/docs/workflows/github-pr-review.md`
- Create: `templates/optional/skills/python-backend/.claude/skills/python-backend/SKILL.md`
- Create: `templates/optional/skills/python-backend/docs/workflows/python-backend.md`
- Create: `templates/optional/skills/ts-react-frontend/.claude/skills/ts-react-frontend/SKILL.md`
- Create: `templates/optional/skills/ts-react-frontend/docs/workflows/ts-react-frontend.md`
- Modify: `src/generator.js`
- Modify: `src/index.js`
- Test: `tests/cli-smoke.test.js`

- [ ] **Step 1: Add failing optional catalog tests**

Append tests to `tests/cli-smoke.test.js`:

```js
test('--list-options prints built-in optional catalog', () => {
  const output = execFileSync(process.execPath, [bin, '--list-options'], { encoding: 'utf8' });
  assert.match(output, /browser-e2e/);
  assert.match(output, /ts-react-frontend/);
  assert.match(output, /web-app/);
});

test('--with copies optional skills and workflows', () => {
  const root = tmpdir();
  const target = path.join(root, 'web');

  execFileSync(process.execPath, [bin, 'web', target, '-y', '--with', 'ts-react-frontend,browser-e2e'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, 'docs', 'workflows', 'browser-e2e.md')));
  assert.match(fs.readFileSync(path.join(target, 'MEMORY.md'), 'utf8'), /ts-react-frontend/);
  assert.match(fs.readFileSync(path.join(target, 'docs', 'README.md'), 'utf8'), /docs\\/workflows\\/browser-e2e\\.md/);
});

test('--preset web-app expands optional skills', () => {
  const root = tmpdir();
  const target = path.join(root, 'web-preset');

  execFileSync(process.execPath, [bin, 'web-preset', target, '-y', '--preset', 'web-app'], { encoding: 'utf8' });

  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ts-react-frontend', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'browser-e2e', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'ui-ux-review', 'SKILL.md')));
});

test('unknown optional skill id exits with readable error', () => {
  const root = tmpdir();
  const target = path.join(root, 'bad');
  const result = spawnSync(process.execPath, [bin, 'bad', target, '-y', '--with', 'not-a-skill'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\\n${result.stderr}`, /not-a-skill/);
  assert.match(`${result.stdout}\\n${result.stderr}`, /--list-options/);
});
```

- [ ] **Step 2: Run optional tests to verify they fail**

Run: `node --test tests/cli-smoke.test.js`

Expected: FAIL because the catalog and copy behavior do not exist.

- [ ] **Step 3: Create catalog and optional templates**

Create `templates/optional/catalog.json` with:

```json
{
  "skills": [
    {
      "id": "browser-e2e",
      "title": "Browser E2E",
      "description": "Playwright or Chrome DevTools/CDP workflow for browser smoke tests, screenshots, traces, and UI evidence.",
      "files": ["skills/browser-e2e"],
      "tags": ["e2e", "browser", "playwright", "cdp"]
    },
    {
      "id": "ui-ux-review",
      "title": "UI/UX Review",
      "description": "Screenshot-driven responsive, accessibility, and visual polish review workflow.",
      "files": ["skills/ui-ux-review"],
      "tags": ["ui", "ux", "accessibility", "review"]
    },
    {
      "id": "github-pr-review",
      "title": "GitHub PR Review",
      "description": "GitHub CLI based PR diff, checks, review findings, and CI evidence workflow.",
      "files": ["skills/github-pr-review"],
      "tags": ["github", "pr", "review", "ci"]
    },
    {
      "id": "python-backend",
      "title": "Python Backend",
      "description": "Python backend workflow for FastAPI or similar APIs with pytest-first verification.",
      "files": ["skills/python-backend"],
      "tags": ["python", "fastapi", "pytest", "api"]
    },
    {
      "id": "ts-react-frontend",
      "title": "TypeScript React Frontend",
      "description": "TypeScript React workflow for typecheck, component tests, builds, and browser smoke.",
      "files": ["skills/ts-react-frontend"],
      "tags": ["typescript", "react", "vite", "frontend"]
    }
  ],
  "presets": {
    "web-app": ["ts-react-frontend", "browser-e2e", "ui-ux-review"],
    "fullstack": ["ts-react-frontend", "python-backend", "browser-e2e", "github-pr-review"]
  }
}
```

Each optional `SKILL.md` must include frontmatter `name` matching the skill id and a short contract:

- when to use
- docs to load
- required inputs
- allowed writes
- output format
- whether to update `docs/harness/PLAN.md`
- whether to use `docs/harness/dispatch.md`

Each workflow doc must include:

- required evidence
- common commands
- fallback when the tool is unavailable
- Windows notes where command syntax matters

- [ ] **Step 4: Implement optional template copy and registration**

Update generator behavior:

- Load `templates/optional/catalog.json`.
- Resolve selected optional ids from `withOptions` plus `preset`.
- Validate unknown ids before writing.
- Copy optional template files after common files.
- Replace `{{projectName}}` in optional files.
- Register selected skills in generated `MEMORY.md#Skills`.
- Add workflow links in generated `docs/README.md`.
- If those files were skipped due existing-project conflict, do not force overwrite; instead report a warning that manual registration is needed.

- [ ] **Step 5: Run optional tests**

Run: `node --test tests/cli-smoke.test.js`

Expected: PASS.

---

### Task 4: Template Guidance And Validator

**Files:**
- Modify: `templates/common/SETUP.md`
- Modify: `templates/common/docs/README.md`
- Modify: `templates/common/docs/harness/extension.md`
- Modify: `templates/common/scripts/validate-harness.mjs`
- Test: `tests/cli-smoke.test.js`

- [ ] **Step 1: Write failing validation test for optional registrations**

Append a test to `tests/cli-smoke.test.js`:

```js
test('generated optional project passes harness validator', () => {
  const root = tmpdir();
  const target = path.join(root, 'validated-web');

  execFileSync(process.execPath, [bin, 'validated-web', target, '-y', '--with', 'browser-e2e,ts-react-frontend'], { encoding: 'utf8' });
  const output = execFileSync(process.execPath, ['scripts/validate-harness.mjs'], { cwd: target, encoding: 'utf8' });

  assert.match(output, /Harness validation passed/);
});
```

- [ ] **Step 2: Run validation test to verify it fails if optional registration is incomplete**

Run: `node --test tests/cli-smoke.test.js`

Expected: FAIL until validator and registration behavior agree.

- [ ] **Step 3: Update template guidance**

Add to `templates/common/SETUP.md`:

- Existing Project Bootstrap Sequence.
- Agent instruction to scan existing `README.md`, package files, test commands, app entry points, and CI before filling harness docs.
- Rule that existing project config is project fact and must not be overwritten without explicit user approval.
- Optional workflow selection examples using `--with` and `--preset`.

Add to `templates/common/docs/README.md`:

- Router row for existing-project onboarding.
- Router row for optional workflows in `docs/workflows/`.

Add to `templates/common/docs/harness/extension.md`:

- Preserve existing `.claude`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `docs/README.md`, workflow docs, and settings unless explicit overwrite is requested.
- Added assets must be registered without replacing core harness docs.

- [ ] **Step 4: Update validator for optional assets**

Update `templates/common/scripts/validate-harness.mjs`:

- Discover `.claude/skills/*/SKILL.md`.
- Keep existing strict checks for core skills.
- For non-core skills, require frontmatter `name` to match directory and `description` to exist.
- If `docs/workflows/*.md` exists, require `docs/README.md` or `MEMORY.md` to mention each workflow path.
- Do not require optional workflows for default projects.

- [ ] **Step 5: Run validation tests**

Run: `node --test tests/cli-smoke.test.js`

Expected: PASS.

---

### Task 5: P0 Package Smoke And Scripts

**Files:**
- Modify: `package.json`
- Create: `tests/pack-smoke.test.js`

- [ ] **Step 1: Write failing package smoke test**

Create `tests/pack-smoke.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('npm pack includes core and optional templates', () => {
  const output = execFileSync('npm', ['pack', '--dry-run'], { encoding: 'utf8' });

  assert.match(output, /templates\\/common\\/SETUP\\.md|templates\\\\common\\\\SETUP\\.md/);
  assert.match(output, /templates\\/optional\\/catalog\\.json|templates\\\\optional\\\\catalog\\.json/);
  assert.match(output, /src\\/generator\\.js|src\\\\generator\\.js/);
});

test('test script runs unit and smoke tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.scripts['test:smoke'], 'node --test tests/cli-smoke.test.js');
  assert.equal(pkg.scripts['pack:smoke'], 'node --test tests/pack-smoke.test.js');
});
```

- [ ] **Step 2: Run package smoke test to verify it fails**

Run: `node --test tests/pack-smoke.test.js`

Expected: FAIL until scripts and optional files exist.

- [ ] **Step 3: Add package scripts**

Update `package.json` scripts:

```json
{
  "start": "node src/index.js",
  "test": "node --test tests/*.test.js",
  "test:smoke": "node --test tests/cli-smoke.test.js",
  "pack:smoke": "node --test tests/pack-smoke.test.js"
}
```

- [ ] **Step 4: Run all P0 tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Run package dry-run smoke**

Run: `npm run pack:smoke`

Expected: PASS.

---

## Final Verification

After all tasks:

Run:

```bash
npm test
node bin/create-harness-vibe-coding.js --help
node bin/create-harness-vibe-coding.js --list-options
```

Then run PowerShell smoke:

```powershell
$Out = Join-Path $env:TEMP ("harness-final-" + [guid]::NewGuid().ToString("N"))
node .\bin\create-harness-vibe-coding.js final-web "$Out\final-web" -y --preset web-app
Push-Location "$Out\final-web"
node .\scripts\validate-harness.mjs
Pop-Location
```

Completion for this plan means P0 scaffold/package safety is proven. It does not complete the broader thread goal until follow-up fixture projects and browser/CDP UI checks are implemented and passing.
