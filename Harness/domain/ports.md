# Port Contracts - create-harness-vibe-coding

> **Responsibility**: Define stable cross-boundary contracts inside the scaffold generator.

---

## 1. Port Classification

### 1.1 Driving Ports

| Port | Definition Location | Purpose |
| --- | --- | --- |
| CLI invocation | `bin/create-harness-vibe-coding.js`, `src/index.js` | Accept project name, target directory, flags, and optional workflow selections |
| Programmatic generator call | `src/generator.js#generate` | Produce a scaffold plan and optionally write files |

### 1.2 Driven Ports

| Port | Definition Location | Purpose |
| --- | --- | --- |
| Template filesystem | `templates/common/**`, `templates/optional/**` | Source files copied or rendered into target projects |
| Target filesystem | `targetDir` passed to `generate()` | Destination for planned scaffold files |
| Optional catalog | `templates/optional/catalog.json` | Defines optional workflow ids, files, and presets |
| Harness validator | `templates/common/scripts/validate-harness.mjs` | Generated structural validation command |

---

## 2. Port Definitions

### CLI Invocation

- **Category**: Driving
- **Definition Location**: `src/index.js`
- **Contract Class**: command-line interface

Preconditions:

- Node.js version satisfies `package.json#engines`.
- Flags use supported names and required values.
- `--json` mode must be machine-readable and non-interactive.

Postconditions:

- Prints readable output for humans unless `--json` is set.
- Exits non-zero when parse errors, unknown options, or generation conflicts fail the run.
- Does not write files in `--dry-run` mode.

### Programmatic Generator Call

- **Category**: Driving
- **Definition Location**: `src/generator.js#generate`
- **Contract Class**: JavaScript function

Preconditions:

- `projectName` and `targetDir` are provided by CLI defaults, prompts, or caller input.
- `onConflict` is one of `fail`, `skip`, `backup`, or `overwrite`.
- Optional workflow ids are known or the result returns errors without writing.

Postconditions:

- Returns `{ success, errors, plan, summary, warnings }`.
- Does not write files when `dryRun` is true.
- Does not write partial scaffold output when a required parent path is a file.
- Applies conflict policy consistently across planned files.

### Template Filesystem

- **Category**: Driven
- **Definition Location**: `templates/**`
- **Contract Class**: repository directory contract

Preconditions:

- Template destination paths must be unique after `harnessDest()` mapping.
- Required generated skill and agent files must have valid frontmatter.

Postconditions:

- Generated projects contain root `Harness/` docs, root `.claude/` runtime assets, and root entry files.
- Optional workflows are copied only when selected.

### Target Filesystem

- **Category**: Driven
- **Definition Location**: `targetDir`
- **Contract Class**: filesystem write boundary

Preconditions:

- Parent directories are writable.
- Existing files are handled according to the selected conflict policy.

Postconditions:

- Existing files are preserved under default `fail` and `skip` policies.
- `backup` preserves prior content using `.harness-backup` names.
- `overwrite` replaces files only when explicitly selected.

---

## 3. Cross-Port Invariants

- `dryRun` must never create directories or files.
- Default conflict policy must never overwrite existing project files.
- Generated Harness docs live under root `Harness/`, not generated `docs/harness/`.
- Optional workflow registrations must point to existing generated files.
- Validator rules and tests must be updated whenever common generated files or required registrations change.
