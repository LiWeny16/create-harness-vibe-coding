# Harness Architecture - create-harness-vibe-coding

> **Responsibility**: Define the repository structure and scaffold generation boundaries.
> **Does NOT cover**: Generated target-project business architecture.

---

## 1. Layering Rules

```text
bin/
  CLI executable shim. Calls src/index.js.

src/
  CLI orchestration and scaffold generation logic.
  May read templates/ and write the chosen target directory.

templates/
  Source of generated scaffold assets.
  Must stay declarative: markdown, skill files, agent files, scripts, and optional workflow docs.

Harness/ and .claude/
  Dogfood runtime for this repository's own agent work.
  Must not be treated as package source unless intentionally copied into templates/.

tests/
  Node test suite for CLI behavior, generator behavior, package contents, and generated harness validation.
```

Hard constraints:

- `templates/common/**` and `templates/optional/**` are the source of generated output.
- Root `Harness/**` is this repository's operating harness; changing it does not change generated projects.
- Generated output paths are normalized by `harnessDest()` in `src/generator.js`.
- Existing-project safety is owned by conflict planning in `src/generator.js`, not by template prose alone.
- Package publication is constrained by `package.json#files`; root dogfood files are not package contents.

## 2. Interface Decoupling

Use interfaces and module boundaries to protect real seams in the generator, not to decorate straightforward code.

- `src/index.js` owns CLI/user interaction; `src/generator.js` owns planning and file writes.
- Template files are declarative inputs; source code should not depend on root dogfood `Harness/**`.
- Optional catalog structure is the extension contract for presets and optional skills.
- Avoid speculative abstraction: do not add plugin systems, generic runners, extra config layers, or service containers until a real second use or testability boundary exists.
- When a boundary is real, express it with a small data contract and test it through generated output behavior.

## 3. State Design

State in this repo should be explicit, serializable, and owned by one layer.

- Generator plan state is computed in memory and returned as `plan`/`summary`; file writes consume that plan instead of re-deciding conflicts.
- Filesystem state is authoritative only through existence/type checks and write results.
- Optional selection state comes from CLI flags plus `templates/optional/catalog.json`; do not duplicate it in template prose.
- Release state lives in `package.json`, npm, git tags, and GitHub; document commands in `README.md`, not `CLAUDE.md`.
- Long-running agent work records resumable status in `Harness/tasks/<task-id>/PLAN.md#Heartbeat`.

## 4. Core Components

### 4.1 CLI Entry

- **Location**: `bin/create-harness-vibe-coding.js`, `src/index.js`
- **Responsibility**: Parse flags, handle interactive/non-interactive modes, print plans/results, and call the generator.
- **Does NOT handle**: Template walking, conflict classification, or file writing internals.

### 4.2 Prompt Layer

- **Location**: `src/prompts.js`
- **Responsibility**: Ask basic interactive npx questions: project name and target directory.
- **Does NOT handle**: Agent-link install intake. That matrix is read by coding agents from `README.md` and `Harness/SETUP.md`.

### 4.3 Generator Core

- **Location**: `src/generator.js`
- **Responsibility**: Resolve optional selections, keep Harness-owned template paths under `Harness/**`, detect conflicts, render templates, register optional workflows, and write files.
- **Critical functions**:
  - `harnessDest()` keeps root entry files at root and Harness-owned files under generated root `Harness/*`.
  - `createPlan()` and `addFileActions()` classify directories and file actions before writes.
  - `registerOptionalContent()` updates generated router/memory docs when optional workflows are selected.

### 4.4 Template Assets

- **Location**: `templates/common/**`, `templates/optional/**`
- **Responsibility**: Define generated `CLAUDE.md`, `AGENTS.md`, `README.md`, `Harness/**`, `.claude/**`, optional skills, and optional workflows.
- **Does NOT handle**: Existing-project decisions. Templates state contracts; generator and agents apply them safely.

### 4.5 Validator

- **Source template**: `templates/common/scripts/validate-harness.mjs`
- **Generated location**: `Harness/scripts/validate-harness.mjs`
- **Responsibility**: Validate required scaffold files, skill/agent registrations, router invariants, optional workflow registrations, and strict project-fact placeholders.

### 4.6 Dogfood Runtime

- **Location**: root `Harness/**`, `.claude/**`, `CLAUDE.md`, `AGENTS.md`, `MEMORY.md`
- **Responsibility**: Govern future AI-agent work in this repository.
- **Does NOT handle**: Changing package output unless edits are made to `templates/**` or source code.

## 5. Data Flow

```text
CLI args / prompts
-> src/index.js parse and display
-> src/generator.js resolve optional catalog
-> walk templates/common and selected templates/optional
-> harnessDest maps source paths to generated destinations
-> createPlan/addFileActions classify create/skip/backup/overwrite/conflict
-> renderTemplate substitutes projectName
-> registerOptionalContent updates generated Harness router/memory
-> write files or return dry-run/json plan
-> tests and generated validator verify behavior
```

## 6. Architectural Constraints

- Do not add generated-output behavior by editing only root `Harness/`; edit `templates/common/**` or `templates/optional/**`.
- Do not add user-facing CLI behavior without tests in `tests/cli-smoke.test.js` or `tests/generator.test.js`.
- Do not add required generated files without updating `templates/common/scripts/validate-harness.mjs` and relevant tests.
- Do not write Harness docs into generated `docs/`; `Harness/` is the generated root for harness-owned docs.
- Do not make root `CLAUDE.md` a dumping ground for build commands, architecture, or release process.

## 7. Known Follow-Up Risks

- Interactive confirmation currently happens before full conflict-plan display in interactive mode.
- Some README tests assert exact prose and can be made more structural.
- `subagent-orchestrator` routing priority should continue to be tightened in templates.
