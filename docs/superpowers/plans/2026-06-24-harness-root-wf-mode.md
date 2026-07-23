# Harness Root WF Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate harness assets under root `Harness/` by default and add a lightweight `wf-mode` long-task workflow with heartbeat recovery.

**Architecture:** Keep root files as thin runtime discovery entries (`CLAUDE.md`, `AGENTS.md`, `.claude/`) and move harness-owned docs, workflows, memory, setup, and validator into `Harness/`. Update the generator by transforming template destination paths so most source templates can be migrated incrementally while generated projects receive the new layout. Add one focused `wf-mode` skill and one workflow document instead of a daemon runtime.

**Tech Stack:** Node.js ESM scaffold generator, Node test runner, Markdown templates.

---

### Task 1: Contract Tests

**Files:**
- Modify: `tests/generator.test.js`
- Modify: `tests/cli-smoke.test.js`
- Modify: `tests/validate-harness.test.js`

- [ ] **Step 1: Add tests asserting generated Harness layout**

Assert fresh generation creates `Harness/README.md`, `Harness/PLAN.md`, `Harness/specs/workflows/WF.md`, `Harness/MEMORY.md`, `Harness/memory/*`, and `Harness/scripts/validate-harness.mjs`, while not creating `docs/README.md` or `docs/harness/PLAN.md`.

- [ ] **Step 2: Add tests asserting optional workflows land under Harness**

Assert optional workflow files are generated as `Harness/workflows/*.md`, registered from `Harness/README.md` with links relative to the Harness directory, and referenced by optional skills.

- [ ] **Step 3: Add tests asserting validation reads Harness paths**

Generate a project, update strict project fact files under `Harness/`, and run `node Harness/scripts/validate-harness.mjs --strict` from the generated project root.

- [ ] **Step 4: Run targeted tests to verify red**

Run: `npm test`
Expected: failures mentioning missing `Harness/*` files and old validator paths.

### Task 2: Generator Path Layout

**Files:**
- Modify: `src/generator.js`
- Modify: `src/index.js`

- [ ] **Step 1: Add deterministic destination path mapping**

Map `SETUP.md` to `Harness/specs/guides/SETUP.md`, `MEMORY.md` to `Harness/MEMORY.md`, `memory/*` to `Harness/memory/*`, `scripts/validate-harness.mjs` to `Harness/scripts/validate-harness.mjs`, `docs/README.md` to `Harness/README.md`, `docs/harness/*` to `Harness/*`, `docs/research/*` to `Harness/research/*`, `docs/domain/*` to `Harness/domain/*`, `docs/features/*` to `Harness/features/*`, and `docs/workflows/*` to `Harness/workflows/*`.

- [ ] **Step 2: Update optional workflow registration**

Register optional workflow links in `Harness/MEMORY.md` and `Harness/README.md` using `workflows/<id>.md`.

- [ ] **Step 3: Update CLI displayed creates and next steps**

Mention `Harness/PLAN.md`, `Harness/specs/guides/SETUP.md`, and `node Harness/scripts/validate-harness.mjs`.

### Task 3: Templates and WF Mode

**Files:**
- Modify: `templates/common/CLAUDE.md`
- Modify: `templates/common/AGENTS.md`
- Modify: `templates/common/SETUP.md`
- Modify: `templates/common/MEMORY.md`
- Modify: `templates/common/docs/**/*.md`
- Modify: `templates/common/.claude/**/*.md`
- Add: `templates/common/docs/harness/WF.md`
- Add: `templates/common/.claude/skills/wf-mode/SKILL.md`
- Add: `templates/common/.claude/commands/wf.md`

- [ ] **Step 1: Make root entry files thin**

`CLAUDE.md` should only point to `Harness/README.md`, `Harness/MEMORY.md`, and `Harness/specs/guides/SETUP.md` and enforce high-level behavior gates.

- [ ] **Step 2: Add `WF.md`**

Document the long-task loop: intake, explorer/research/architect passes, synthesis, second plan, tests, implementation, review, real-browser/API verification where applicable, debugger recovery, and closeout evidence.

- [ ] **Step 3: Add `wf-mode` skill**

Trigger on `/wf`, `wf mode`, long/difficult tasks, multi-file work, uncertainty, repeated failures, or web/UI acceptance work.

- [ ] **Step 4: Add heartbeat protocol**

Add `## Heartbeat` to `PLAN.md` with mode, last beat, phase, blocker, next beat trigger, failure count, and recovery action.

### Task 4: Validator and Docs

**Files:**
- Modify: `templates/common/scripts/validate-harness.mjs`
- Modify: `README.md`
- Modify: tests from Task 1 as needed

- [ ] **Step 1: Update required files and strict project facts**

Validator should require `Harness/*` paths and the `wf-mode` skill.

- [ ] **Step 2: Update text invariants**

Check durable communication invariants in `Harness/README.md`, `Harness/specs/runtime/dispatch.md`, and `Harness/specs/runtime/context-loading.md`; check heartbeat and WF markers.

- [ ] **Step 3: Update README public contract**

Document root `Harness/` default layout, the thin root exceptions, `/wf` behavior, and heartbeat as a lightweight recovery protocol rather than a daemon.

### Task 5: Verification

**Files:**
- No planned source changes unless tests expose a bug.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run smoke commands**

Run: `node bin/create-harness-vibe-coding.js --help`
Run: `node bin/create-harness-vibe-coding.js wf-smoke <temp-dir> -y --preset web-app`
Run: `node Harness/scripts/validate-harness.mjs` from the generated project root.

- [ ] **Step 3: Inspect git diff**

Confirm changed files are scoped to generator, templates, tests, docs, and plan.
