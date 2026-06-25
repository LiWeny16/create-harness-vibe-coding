# create-harness-vibe-coding - Research Results

> **Purpose**: Record research inputs and decisions that shaped the scaffold.
> **Principle**: Each candidate has a clear Purpose / Strength / Weakness / Decision.

---

## Research Date

2026-06-24

## Research Goal

Decide how this repository should dogfood the generated Harness scaffold after moving generated harness-owned docs to root `Harness/`.

---

## Candidate References

### 1) Local Claude Code Review Report

- **What it is**: User-provided multi-agent review output for the current repository.
- **Source Type**: local review artifact
- **Checked Date**: 2026-06-24
- **Strengths**: Identified root `CLAUDE.md` and `MEMORY.md` still pointing at stale `docs/harness/` paths.
- **Weaknesses**: Some severity labels overstated generator risks that require explicit conflict policy.
- **Decision**: ADOPT root dogfood finding; PARTIAL for overwrite and routing recommendations.
- **Link**: conversation context

### 2) Current Generator Templates

- **What it is**: `templates/common/**` and `templates/optional/**`, the package source for generated scaffold files.
- **Source Type**: repository source
- **Checked Date**: 2026-06-24
- **Strengths**: Defines root `Harness/`, `.claude/`, memory, workflow, subagent, and validator assets.
- **Weaknesses**: Template project facts require project-specific bootstrap before strict validation.
- **Decision**: ADOPT as dogfood runtime source with root conflicts skipped.
- **Link**: `templates/common/`

### 3) Local Test And Validator Suite

- **What it is**: Node test suite and generated `Harness/scripts/validate-harness.mjs`.
- **Source Type**: repository test code
- **Checked Date**: 2026-06-24
- **Strengths**: Covers conflict policies, path mapping, optional workflow registration, memory triggers, and scaffold validation.
- **Weaknesses**: Some README checks still assert exact prose and can be made more structural later.
- **Decision**: ADOPT as verification gate.
- **Link**: `tests/`

---

## Final Decision

- **Architecture Style**: Node CLI scaffold generator with a dogfooded root Harness runtime for agent operations.
- **Core References**: `src/generator.js`, `src/index.js`, `templates/common/`, `Harness/README.md`, `Harness/MEMORY.md`.
- **Key Constraints**:
  - Package source remains under `bin/`, `src/`, and `templates/`; root `Harness/` is repo operating guidance.
  - Existing root `README.md`, `.gitignore`, and package files are project facts and must not be overwritten by dogfood generation.
  - Future agent work should route through `Harness/README.md` and record durable state in `Harness/PROGRESS.md` and `Harness/tasks/<task-id>/PLAN.md`.

---

## Not Adopted But Worth Watching

- Move all root dogfood files into the npm package: rejected because `package.json#files` already limits publish contents to `bin/`, `src/`, and `templates/`.
- Implement the full Agent-link intake matrix in `src/prompts.js`: not adopted now; the matrix is intentionally for agent-driven installs, while npx stays deterministic.
