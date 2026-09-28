# task-architecture-review-wf-0921 - REVIEW.md

Evidence-based read-only architecture review. No business code, command, skill, hook, template, or test was modified during this task.

**Review scope**: All WF commands (19 across `.claude/` + `.opencode/`, with Codex compat skills under `.agents/`), skills (23 in `.claude/skills/` + 24 in `.agents/skills/`), Harness runtime (`Harness/scripts/`, `Harness/a2a/`, `Harness/tasks/`, `Harness/memory/`, `Harness/specs/`), templates (`templates/common/`, `templates/optional/`), generators (`src/index.js`, `src/generator.js`), gates (`scripts/check-update-mirrors.mjs`, `scripts/pre-push-check.mjs`, `Harness/scripts/validate-harness.mjs`, `package.json` scripts), CI (`.github/workflows/ci.yml`), and agent collaboration surfaces.

**Verdict**: **YELLOW** — do not publish 0.9.6 until the P0 release-policy baseline is resolved or explicitly waived. P1 is next-major/documentation debt, not an independent 0.9.6 release blocker.

Reasoning:
1. `scripts/check-update-mirrors.mjs` is currently **failing**: legacy `zingspark/main` mirror shows `generator 0.9.4 != package 0.9.5`, and `zingspark/v0.9.5` returns HTTP 404. The gate's own exit message says "Sync https://github.com/zingspark/create-harness-vibe-coding before marking the release done." This is a real blocker.
2. `Harness/scripts/task-state.mjs` (99 KB) and `Harness/scripts/wf-ui-control.mjs` (145 KB) are monolithic runtime surfaces; they carry the core WF state machine and the A2A control plane. They are covered by tests but have no modularity boundaries — regression risk is high for any change.
3. `templates/common/Harness/scripts/{memory-context,research-policy}.mjs` are public CLI entry points delegating to `lib/{memory-context,research-policy}.mjs`; this is intentional layering and needs API documentation, not deletion (P1).
4. Legacy zingspark repo drift is real: `check-update-mirrors.mjs` still checks `https://github.com/zingspark/create-harness-vibe-coding` and fails against it. This is either intentional dual-publishing or a legacy path that should be retired (P2).
5. Ownership model is sound (`Harness/ownership.manifest.json` with preserve/merge/frameworkOwned/optionalOwned/moves). This is the single strongest architectural feature.

---

## 1. Inventory

### 1.1 Command surfaces (19 commands × 2 host trees + Codex compat)

| Command | `.claude/commands/` | `.opencode/commands/` | Codex compat skill | Direct/Compat | WF kernel |
|---------|---------------------|-----------------------|--------------------|---------------|-----------|
| `wf` | ✓ | ✓ | `.agents/skills/wf/` | ✗ | ✓ |
| `wf-max` | ✓ | ✓ | `.agents/skills/wf-max/` | ✗ | ✓ |
| `wf-auto` | ✓ | ✓ | `.agents/skills/wf-auto/` | ✗ | ✓ |
| `wf-auto-spark` | ✓ | ✓ | `.agents/skills/wf-auto-spark/` | ✗ | ✓ |
| `wf-review` | ✓ | ✓ | `.agents/skills/wf-review/` | ✗ | ✓ |
| `wf-research` | ✓ | ✓ | `.agents/skills/wf-research/` | ✓ | ✗ |
| `wf-search` | ✓ | ✓ | `.agents/skills/wf-search/` | ✓ | ✗ |
| `wf-learn` | ✓ | ✓ | `.agents/skills/wf-learn/` | ✓ | ✗ |
| `wf-readme` | ✓ | ✓ | `.agents/skills/wf-readme/` | ✗ | ✓ |
| `wf-remove` | ✓ | ✓ | `.agents/skills/wf-remove/` | ✗ | ✓ |
| `wf-browser` | ✓ | ✓ | `.agents/skills/wf-browser/` | ✗ | ✓ |
| `wf-init` | ✓ | ✓ | `.agents/skills/wf-init/` | ✓ | ✗ |
| `wf-help` | ✓ | ✓ | `.agents/skills/wf-help/` | ✓ | ✗ |
| `wf-update` | ✓ | ✓ | `.agents/skills/wf-update/` | ✓ | ✗ |
| `wf-ui` | ✓ | ✓ | `.agents/skills/wf-ui/` | ✓ | ✗ |
| `wf-task-record` | ✓ | ✓ | `.agents/skills/wf-task-record/` | ✓ | ✗ |
| `wf-task-list` | ✓ | ✓ | `.agents/skills/wf-task-list/` | ✓ | ✗ |
| `wf-task-archive` | ✓ | ✓ | `.agents/skills/wf-task-archive/` | ✓ | ✗ |
| `wf-command-create` | ✓ | ✓ | `.agents/skills/wf-command-create/` | ✓ | ✗ |

Additional skills with no command twin:
- `.claude/skills/improve-codebase-architecture/` — only in `.claude/skills/`, **not** in `.agents/skills/`. See F-005.
- `.claude/skills/subagent-orchestrator/`, `.claude/skills/tdd/` — in both trees.
- `.agents/skills/make-interfaces-feel-better/` — only in `.agents/skills/`, **not** in `.claude/skills/`. See F-006.

Evidence: `ls .claude/commands/` → 19 entries; `ls .opencode/commands/` → 19 entries; `ls .claude/skills/` → 24 entries; `ls .agents/skills/` → 25 entries (including `make-interfaces-feel-better`); `ls .codex/` → only `config.toml` + `hooks.json`.

### 1.2 Agent surfaces

`.claude/agents/` and `.opencode/agents/` each contain 20 agent `.md` files (identical names):
architect, architect-manager, codebase-explorer, context-master, debugger, docs-researcher, explore-manager, implement-manager, implementer, memory-master, planner, reflector, researcher, review-manager, reviewer, task-scribe, tdd-guide, test-writer, verifier.

Evidence: `ls .opencode/agents/` (20 entries) matches `.claude/agents/` in name. Both are listed in `Harness/ownership.manifest.json` `frameworkOwned` as `kind: agent`.

### 1.3 Runtime scripts

`Harness/scripts/` — 23 top-level `.mjs` + `lib/` with 6 modules:

| Script | Size (bytes) | Purpose |
|--------|--------------|---------|
| `task-state.mjs` | 99 535 | Task CRUD, lifecycle, archive, history |
| `wf-ui-control.mjs` | 144 381 | A2A control plane CLI (workflow-context, snapshot, help --json, manuals) |
| `validate-harness.mjs` | 106 173 | Scaffold validator (structure, links, agents, skills, strict tokens, manifest-audit) |
| `wf-update-check.mjs` | 58 108 | Update checker against GitHub mirrors |
| `wf-update-runner.mjs` | 14 438 | Runs updates with manifest-driven moves |
| `scan-clean.mjs` | 20 997 | Scan + clean |
| `task-context.mjs` | 27 696 | Role-scoped task pack, resume input |
| `wf-search-video.mjs` | 10 998 | Video temporal evidence |
| `wf-remove.mjs` | 26 967 | Scaffold removal with SAFE/MODIFIED/USER classification |
| `extensions.mjs` | 18 120 | Extensions registry |
| `task-group-index.mjs` | 8 015 | Task group index |
| `wf-research.mjs` | 9 812 | Deep research entry |
| `a2a-terminal.mjs` | 7 359 | A2A terminal bridge |
| `wf-auto-update-prompt.mjs` | 8 307 | Codex SessionStart hook payload |
| `wf-search.mjs` | 2 707 | Thin CLI over `lib/wf-search.mjs` |
| `wf-search-download.mjs` | 6 251 | Download artifacts |
| `archive-tasks.mjs` | 1 044 | Weekly archive |
| `auto-archive-session-start.mjs` | 2 815 | Codex SessionStart auto-archive |
| `context-budget.mjs` | 2 951 | Context budget gate |
| `memory-context.mjs` | 2 755 | **Thin wrapper around `lib/memory-context.mjs`** |
| `research-policy.mjs` | 1 554 | **Thin wrapper around `lib/research-policy.mjs`** |
| `l2-cache-telemetry.mjs` | 26 087 | L2 cache telemetry |
| `sync-host-global.mjs` | 9 285 | Sync host-global runtime |

`Harness/scripts/lib/`: `memory-context.mjs`, `path-scope.mjs`, `research-policy.mjs`, `task-route.mjs`, `wf-research.mjs`, `wf-search.mjs`.

### 1.4 A2A state surface

`Harness/a2a/` is **98 MB** and contains:
- `action-registry.json` (108 KB)
- `workflow-map.json` (208 KB)
- `workspace-ops.jsonl` (94 KB)
- `workflow-operations.jsonl` (9.6 KB)
- `role-graph.json` (3.3 KB), `runtime-registry.json` (136 B), `workflows.json` (1.6 KB)
- Subdirectories: `agent-roles/`, `bridges/`, `capability-nodes/`, `component-nodes/`, `event-nodes/`, `events/`, `goal-nodes/`, `nodes/`, `sessions/`, `skills/`
- `skills/` holds 17 JSON node-type descriptors (terminal-control, wf-ui-map, workflow-*).

CLAUDE.md explicitly says: *"Workflow node state files under `Harness/a2a/**/state.json` and `Harness/a2a/workflow-map.json` are backend-owned diagnostic storage, not control surfaces, nor information sources — read graph and connection state only through the typed wf-ui API/CLI."*

**Finding**: `action-registry.json` is a checked-in, framework-owned static action contract. `workflow-map.json` is checked in and backend-owned by contract, but is not listed in the ownership manifest. The actual gap is an unclassified update/ownership boundary for `workflow-map.json`, not a manifest entry marking it framework-owned.

### 1.5 Task capsules

`Harness/tasks/` has 7 active capsules + `_archive/` + `_template/` + `GROUPS.md` + `INDEX.json` + `INDEX.md`:
- `task-add-web-agent-node` (wf-max, intake)
- `task-architecture-review-wf-0921` (this task)
- `task-homepage-act1-flat-layout` (implement)
- `task-make-wf-lifecycle-0908` (verify)
- `task-route-wf-search-deep-media` (implement)
- `task-simplify-skills-hub-pack-prompt` (implement)
- `task-upgrade-harness-092` (verify, project=harness-upgrade)

`INDEX.json` confirms: `"sourceOfTruth": "Harness/tasks/*/STATE.json"` and `"activeTask": null`.

### 1.6 Specs

`Harness/specs/` contains:
- `protocols/` — 7 files: ACCEPTANCE_PROTOCOL, AGENT_ISOLATION, DEBUG_PROTOCOL, HARNESS_BRIDGE, MEMORY_PROTOCOL, TASK_ARCHIVE, TDD-GUIDE
- `runtime/` — 5 files: agent-workflow.md, command-surface.json, context-loading.md, dispatch.md, subagents.md
- `workflows/` — 8 files: WF, WF-AUTO, WF-AUTO-ANGLES, WF-AUTO-SPARK, WF-KERNEL, WF-MAX, WF-STATE
- `guides/` — 4 files: ECC-GUIDE, SETUP, extension, lifecycle
- `cooperation/` — contents not inspected (see F-011)

No duplicates found at file-name level. Ownership manifest confirms all are `frameworkOwned` with `overwrite: safe`.

### 1.7 Templates and generator

- `templates/common/` — the canonical scaffold source (dogfood runtime is generated from here)
- `templates/optional/` — optional skills catalog + `catalog.json`
- `src/index.js` (64 KB), `src/generator.js` (48 KB) — scaffold generator
- `src/wf-ui-server/` — A2A control-plane server (3.1 MB, modular: `a2a-store.mjs`, `action-registry.mjs`, `bridge-store.mjs`, `chat-driver.mjs`, `chat-store.mjs`, `composition-api.mjs`, `dispatch-contract.mjs`, `drivers/`, `file-format-adapters.mjs`, `file-watcher.mjs`, `graph-layout.mjs`, `harness-env.mjs`, `json-store-utils.mjs`, `control-plane-token.mjs`, `claude-transcript-materializer.mjs`, `codex-update-prompt.mjs`, `component-node-store.mjs`, `excalidraw-svg.mjs`)
- `src/ui/` — 482 MB node_modules + 54 MB dist + 1.6 MB src (React/Vite UI for wf-ui)

### 1.8 Memory

`Harness/memory/` — 5 files:
- `agent-lessons-patterns.md` (11 KB)
- `routes.md` (2.6 KB)
- `startup-hints.md` (1.5 KB) — L2 lightweight digest, CLAUDE.md default load
- `tool-usage-reflections.md` (2.7 KB)
- `user-corrections-preferences.md` (2.2 KB)

Ownership manifest maps these to `memory/*.md` (not `Harness/memory/*.md`) — the `sources` block maps e.g. `"Harness/memory/agent-lessons-patterns.md": "memory/agent-lessons-patterns.md"`. This is the source-of-truth for the runtime.

### 1.9 Gate scripts

| Gate | Path | Purpose |
|------|------|---------|
| `check:mirrors` | `scripts/check-update-mirrors.mjs` | Verify canonical + legacy GitHub mirrors |
| `prepush` | `scripts/pre-push-check.mjs` | Pre-push gate |
| `test` | `npm test` → `node --test tests/*.test.js` | All unit/integration tests |
| `test:e2e` | `node tests/e2e-wf-scripts.test.mjs` | E2E for workflow scripts |
| `test:smoke` | `node --test tests/cli-smoke.test.js` | CLI smoke |
| `pack:smoke` | `node --test tests/pack-smoke.test.js` | Packed artifact smoke |
| CI `harness-check` | `node scripts/build-version.mjs --check` + `node templates/common/Harness/scripts/validate-harness.mjs --strict` | Validate version + scaffold |
| CI `test` | `npm install` + `npm test` + `npm run test:e2e` + `npm run pack:smoke` | Full test matrix |

### 1.10 Tests

`tests/` — ~53 test files. Categories:
- **Core**: `task-state.test.js`, `task-context.test.js`, `task-context-w3.test.js`, `task-state-closeout.test.js`, `capsule-routing.test.js`, `runtime-dispatch-cli.test.js`
- **wf-search family** (10 tests): `wf-search.test.js`, `wf-search-ai.test.js`, `wf-search-download.test.js`, `wf-search-install.test.js`, `wf-search-media.test.js`, `wf-research.test.js`
- **Verify/review ad-hoc** (10 tests): `review-chat-effort-092.test.js`, `review-cross-contract-092.test.js`, `review-effort-server-092.test.js`, `review-server-version-092.test.js`, `review-skills-market-ac-003-004.test.mjs`, `verify-context-memory-092.test.js`, `verify-runtime-release-cli-project.test.js`, `verify-runtime-release-png-only.test.js`
- **Node composition** (4 tests): `node-composition-api.test.mjs`, `node-composition-consistency-hardening.test.mjs`, `node-composition-hardening.test.mjs`, `node-composition-matrix.test.mjs`
- **Harness intelligence** (5 tests): `harness-bench.test.js`, `harness-intelligence-bench.test.js`, `harness-intelligence-bench-review.test.js`, `harness-intelligence-boundaries.test.js`, `harness-intelligence-install.test.js`, `harness-intelligence-policy.test.js`
- **Validator/mirror**: `validate-harness.test.js`, `check-harness-version.test.js`, `anti-drift.test.js`, `p0-blockers.test.js`, `ownership-manifest.test.js`
- **Memory/context**: `context-budget.test.js`, `memory-context.test.js`, `l1-prefix-simulation.test.js`, `l2-cache-telemetry.test.js`, `research-policy.test.js`
- **Update**: `update-collision.test.js`, `update-prompt.test.js`, `wf-update-runner.test.js`
- **Misc**: `cli-smoke.test.js`, `e2e-wf-scripts.test.mjs`, `frontend-backend-boundary.test.mjs`, `generator.test.js`, `pack-smoke.test.js`, `wf-backend-ensure.test.js`, `wf-learn-contract.test.js`, `extensions.test.js`

---

## 2. Source of truth / ownership matrix

| Surface | Canonical | Mirror/derived | Writer | Reader |
|---------|-----------|----------------|--------|--------|
| Command `.md` | `templates/common/.claude/commands/*.md` | `.claude/commands/`, `.opencode/commands/` | `generator.js` (bootstrap) or `wf-update-runner.mjs` | Claude Code, OpenCode hosts |
| Skill `SKILL.md` | `templates/common/.claude/skills/*/SKILL.md` | `.agents/skills/`, `.claude/skills/` | `generator.js` / `wf-update-runner.mjs` | Claude Code, Codex, OpenCode |
| Agent `.md` | `templates/common/.claude/agents/*.md` | `.opencode/agents/` | `generator.js` / `wf-update-runner.mjs` | Claude Code, OpenCode |
| Runtime scripts | `templates/common/Harness/scripts/*.mjs` | `Harness/scripts/` | `generator.js` / `wf-update-runner.mjs` | Agents |
| Specs | `templates/common/Harness/specs/**/*.md` | `Harness/specs/` | `generator.js` / `wf-update-runner.mjs` | Agents |
| `CLAUDE.md` | `templates/common/CLAUDE.md` | `CLAUDE.md` (merge mode) | `generator.js` (merge) | Host router |
| `ownership.manifest.json` | `templates/common/Harness/ownership.manifest.json` | `Harness/ownership.manifest.json` | `generator.js` | `validate-harness.mjs`, `wf-update-runner.mjs` |
| Task STATE.json | `Harness/tasks/*/STATE.json` | `Harness/tasks/INDEX.json` (derived) | `task-state.mjs` | `task-state.mjs`, `task-context.mjs`, agents |
| A2A state | `Harness/a2a/**` | n/a (runtime) | `wf-ui-control.mjs`, `src/wf-ui-server/*` | `wf-ui-control.mjs` (typed CLI only) |
| Memory | `templates/common/memory/*.md` | `Harness/memory/*.md` | `generator.js` (initial), `memory-master` agent (subsequent) | `startup-hints.md` on session start |
| `.harness-version` | `templates/common/.harness-version` | `Harness/.harness-version` | `generator.js` | `wf-update-check.mjs`, CI `build-version.mjs` |

**Key observation**: The ownership model is **explicit and machine-readable**. `ownership.manifest.json` distinguishes `preserve`, `merge`, `frameworkOwned`, `optionalOwned`, `moves`, `acceptedConflicts`, `releaseNotes`. This is the strongest architectural feature.

**Key boundary gap (W7 corrected)**: `workflow-map.json` (208 KB) under `Harness/a2a/` is not listed in the ownership manifest, while CLAUDE.md explicitly says it is *backend-owned diagnostic storage, not a control surface*. The updater behavior for an existing unlisted runtime file must be verified. `action-registry.json` (108 KB) is correctly `frameworkOwned` as a static framework contract. See F-004a / F-004b.

---

## 3. Findings

### Findings Index (W7 corrected)

| Severity | Findings |
|----------|----------|
| **P0 — release-policy baseline** | F-001 |
| **P1 — should fix before next major** | F-002 (public CLI wrappers, documentation task) |
| **P2 — should fix** | F-003 (deferred), F-007, F-008, F-009, F-010, F-018, F-019, F-020, F-021, F-022, F-023, F-024, F-025, F-026 |
| **P3 — cleanup / future** | F-004a, F-004b (documentation/contract), F-005 (conditional), F-006 (conditional), F-011, F-012, F-013, F-014, F-015, F-016, F-017 |

**W7 corrections** (see §10 for full log):
- F-001: Reclassified as release-policy baseline
- F-002: Corrected — public CLI wrappers, not duplicates; documentation task
- F-003: Downgraded P1 → P2 (deferred technical debt)
- F-004: Split into F-004a (action-registry, correctly frameworkOwned) and F-004b (workflow-map, needs ownership verification)
- F-005/F-006: Downgraded P1 → P3 (conditional, depends on cross-runtime intent)
- Gate report: Unrun tests marked as **INCOMPLETE** instead of "Not run"

**Note**: The findings below are physically grouped by original section. Use the index above for the corrected severity mapping.

### P0 (release-policy baseline)

**F-001 — Mirror gate failing is a release-policy baseline exception (zingspark legacy drift)**
- **Fact**: `node scripts/check-update-mirrors.mjs` exits non-zero with:
  ```
  canonical LiWeny16 main... PASS
  legacy zingspark main... FAIL (generator 0.9.4 != package 0.9.5)
  canonical LiWeny16 v0.9.5... PASS
  legacy zingspark v0.9.5... FAIL (HTTP 404)

  2 mirror check(s) failed. Sync https://github.com/zingspark/create-harness-vibe-coding before marking the release done.
  ```
- **Classification (W7)**: This is a **release-policy baseline**, not a code defect. The canonical mirror (LiWeny16) passes; only the legacy zingspark mirror fails. Per the gate contract, publishing 0.9.6 with this failure is a policy violation, but the failure itself is a known baseline condition, not a regression introduced by this review.
- **Evidence**: `scripts/check-update-mirrors.mjs` (command output above); `Harness/ownership.manifest.json:5` lists `source: https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/templates/common/` — canonical mirror is LiWeny16, the gate still checks zingspark as "legacy".
- **Baseline exception (recorded)**: The zingspark mirror failure is a pre-existing condition. Either (a) sync zingspark to 0.9.5 and tag v0.9.5, (b) remove the zingspark check from `check-update-mirrors.mjs`, or (c) record an explicit baseline-exception note in the release notes. Repo owner decides. **Verdict YELLOW is maintained** because publishing while the gate fails violates the release policy.

### P1 (should fix before next major)

**F-002 — Public CLI wrappers `memory-context.mjs` and `research-policy.mjs` need documented API contract (NOT removable)**
- **Fact (W7 correction)**: `Harness/scripts/memory-context.mjs` (2 755 bytes) and `Harness/scripts/research-policy.mjs` (1 554 bytes) are **the public CLI entry points**. They are invoked by `.claude/commands/wf.md` and `.opencode/commands/wf.md` (e.g., `node Harness/scripts/research-policy.mjs decide`). The `lib/` versions are implementation modules imported by the top-level wrappers.
- **Previous wording was wrong**: The original finding framed these as "duplicate" or "redundant surface" — this was a mischaracterization. The top-level files are the **public API**; the `lib/` files are the **implementation**. Removing the top-level wrappers would break the documented command interface.
- **Correct classification**: These are an intentional layering pattern — public CLI entry points delegating to `lib/` modules. The same pattern is used by `wf-search.mjs` (top-level) and `lib/wf-search.mjs` (implementation).
- **Evidence**: `.claude/commands/wf.md:14` invokes `node Harness/scripts/memory-context.mjs`; `.claude/commands/wf.md:19` invokes `node Harness/scripts/research-policy.mjs`; `.claude/commands/wf-search.md:54` invokes `node Harness/scripts/wf-search.mjs`.
- **Action**: Document the API contract for these public CLI scripts in `Harness/scripts/README.md` (or a dedicated `API.md`). Do **not** delete or collapse them. Verify the `lib/` split is the right modular pattern for future scripts.
- **Severity**: P1 → Documentation task (not a deletion task). Do not classify as "redundant surface" in future reviews.

### P2 (should fix)

**F-003 — `wf-ui-control.mjs` (145 KB) and `task-state.mjs` (99 KB) are monolithic runtime surfaces (deferred technical debt)**
- **Fact**: `wf-ui-control.mjs` is a single file implementing the entire A2A control plane CLI. `task-state.mjs` is a single file implementing the entire task lifecycle. Both are covered by tests but have no modular boundaries.
- **Impact**: Any change to the control plane or task state machine is high-risk. Code review cost is high. Regression risk compounds over time.
- **Evidence**: `ls -la Harness/scripts/wf-ui-control.mjs` → 144 381 bytes; `ls -la Harness/scripts/task-state.mjs` → 99 535 bytes; `Harness/scripts/README.md` documents 15+ subcommands for `task-state.mjs` alone.
- **W7 correction**: Downgraded from P1 to P2. This is deferred technical debt, not a release blocker. The monolithic structure is a known trade-off for runtime simplicity. Refactoring requires a dedicated task with explicit scope and test coverage.
- **Recommendation**: Extract `lib/` modules for each subcommand (similar to how `wf-search.mjs` was split into `lib/wf-search.mjs`). Defer to a dedicated task when the next major version is planned.

### P3 (cleanup / future)

**F-004b — `workflow-map.json` ownership/update contract should be documented**
- **Fact**: `Harness/ownership.manifest.json` lists `Harness/a2a/action-registry.json` as `frameworkOwned`; it does **not** list `Harness/a2a/workflow-map.json`. CLAUDE.md explicitly says *"Workflow node state files under `Harness/a2a/**/state.json` and `Harness/a2a/workflow-map.json` are backend-owned diagnostic storage, not control surfaces"*.
- **W7 correction**: The original finding treated both files identically. They have different characteristics:
  - **`action-registry.json`**: A static framework contract describing supported actions. It is correctly `frameworkOwned` because it ships with the framework and should be updated alongside framework updates. The current manifest classification is **correct**.
  - **`workflow-map.json`**: A runtime map describing workflow topology. CLAUDE.md says it is "backend-owned diagnostic storage". It is absent from the manifest and absent from `templates/common/Harness/a2a/`; the updater therefore has no remote checksum for it and skips files that are not in the remote set.
- **Evidence**: `CLAUDE.md` line about `Harness/a2a/**/state.json` and `Harness/a2a/workflow-map.json`; `rg -n "workflow-map.json" Harness/ownership.manifest.json` returns no manifest entry; `Test-Path templates/common/Harness/a2a/workflow-map.json` is `False`; `Harness/scripts/wf-update-check.mjs:1170-1175` skips a file when `remoteHash` is absent with reason `not in remote`.
- **Split actions**:
  - **F-004a (action-registry.json)**: Keep as `frameworkOwned`. No change needed. Document this as a static framework contract in the manifest comment or README.
  - **F-004b (workflow-map.json)**: Document that it is runtime-only and absent from the scaffold/update checksum set. Do not change the manifest unless the project intentionally makes it part of the framework update contract.
- **Severity**: P3 for F-004b (documentation/contract clarity); no current overwrite evidence.

**F-005 — `.claude/skills/improve-codebase-architecture/` has no `.agents/` mirror (conditional)**
- **Fact**: `.claude/skills/improve-codebase-architecture/` exists but `.agents/skills/` has no corresponding directory.
- **W7 correction**: Downgraded from P1 to P3. This is a **conditional** issue — only a problem if the skill is intended to be cross-runtime. If it is intentionally Claude-only, no mirror is needed.
- **Evidence**: `ls .claude/skills/` includes `improve-codebase-architecture`; `ls .agents/skills/` does not. The skill has `disable-model-invocation: true` in frontmatter.
- **Action**: Confirm with repo owner whether this skill should be cross-runtime. If yes, add the `.agents/` mirror. If no, document the Claude-only intent in the skill README.

**F-006 — `.agents/skills/make-interfaces-feel-better/` has no `.claude/` mirror (conditional)**
- **Fact**: `.agents/skills/make-interfaces-feel-better/` exists but `.claude/skills/` has no corresponding directory.
- **W7 correction**: Downgraded from P1 to P3. Inverse of F-005 — also conditional on whether this skill should be cross-runtime.
- **Evidence**: `ls .agents/skills/` includes `make-interfaces-feel-better`; `ls .claude/skills/` does not.
- **Action**: Same as F-005 — confirm intent with repo owner, then mirror or document.

**F-007 — `Harness/templates/` vs `templates/` naming confusion**
- **Fact**: `Harness/templates/` contains 7 `.template.md` files (ACCEPTANCE, API_CONTRACT, PLAYWRIGHT_SPEC, PRD, TEST_PLAN, UI_CONTRACT, VALIDATION_REPORT). `templates/` (root) contains `common/` and `optional/` — the scaffold source. These are different things with confusing names.
- **Impact**: New contributors may confuse `Harness/templates/` (artifact templates) with `templates/` (scaffold source). Documentation does not disambiguate clearly.
- **Evidence**: `ls Harness/templates/` → 7 template files; `ls templates/` → `common`, `optional`; `ls templates/common/` → `Harness`, `.claude`, `.opencode`, `CLAUDE.md`, etc.
- **Recommendation**: Rename `Harness/templates/` to `Harness/artifact-templates/` or document the distinction prominently in README.

**F-008 — Orphan files at repo root (mixed gitignore status)**
- **Fact**: Several orphan files exist at repo root:
  - `.tmp-edge-check-79e45d/`, `.tmp-pack.json`, `.tmp-pack-after.json`, `.tmp-workflow-before.json` — **IGNORED** by `.gitignore` (`.tmp-*` rule)
  - `debug.log` — **IGNORED** by `.gitignore` (`/debug.log` rule)
  - `nul` (0-byte) — **NOT ignored**
  - `3080.md` (22 KB) — **NOT ignored**
  - `3080-xianyu-cover.png` (1.9 MB) — **NOT ignored**
  - `test-results/` — **IGNORED** by `.gitignore`
- **Impact**: The ignored files pollute the working tree but not git. The non-ignored files (`nul`, `3080.md`, `3080-xianyu-cover.png`) are visible to git and should not be there.
- **Evidence**: `git check-ignore -v` for each file; `.gitignore` lines 83-85.
- **Recommendation**: Delete `nul`, `3080.md`, `3080-xianyu-cover.png`. Add `.tmp-*`, `/debug.log`, `/test-results/` to `.gitignore` if not already present.

**F-009 — `Harness/scripts/tmp-wfui-out.log` (32 bytes) is committed**
- **Fact**: A 32-byte log file is committed in `Harness/scripts/`. This is a debug artifact.
- **Impact**: Noise in the runtime surface.
- **Evidence**: `ls -la Harness/scripts/tmp-wfui-out.log`.
- **Recommendation**: Delete.

**F-010 — `Harness/scripts/debug-memory-fixture2/` committed**
- **Fact**: A debug fixture directory is committed in `Harness/scripts/`.
- **Impact**: Debug artifact in production surface.
- **Evidence**: `ls -la Harness/scripts/debug-memory-fixture2/`.
- **Recommendation**: Move to `tests/fixtures/` or delete.

**F-011 — `Harness/specs/cooperation/` contains `agent-team-cooperation-spec.md`**
- **Fact**: `Harness/specs/cooperation/agent-team-cooperation-spec.md` exists.
- **Impact**: This spec is not referenced by any command, skill, or runtime script found in this review. It may be a draft or dead spec.
- **Evidence**: `find Harness/specs/cooperation -type f` → 1 file.
- **Recommendation**: Verify if this spec is still active. If not, move to archive or delete.

**F-012 — `Harness/wf-browser/tmp/` is 270 MB of runtime artifacts (gitignored)**
- **Fact**: `Harness/wf-browser/tmp/browser-profiles/` is 270 MB. `Harness/wf-browser/runs/` contains 6 run directories. Both are **gitignored** by `.gitignore` rules `Harness/wf-browser/tmp/` and `Harness/wf-browser/runs/`. The ownership manifest only lists `Harness/wf-browser/README.md` as `frameworkOwned`.
- **Impact**: The 270 MB is local runtime state, not committed to git. This is correct behavior. However, the size is large and may indicate that browser profiles are not being cleaned up.
- **Evidence**: `du -sh Harness/wf-browser/*` → `270M Harness/wf-browser/tmp`, `1.3M Harness/wf-browser/runs`; `git check-ignore -v Harness/wf-browser/tmp/` → ignored.
- **Recommendation**: Add a cleanup step to `wf-browser` that removes old browser profiles. Document the expected size.

**F-013 — `extensions/wf-search-deep/` is a full extension (not in ownership manifest)**
- **Fact**: `extensions/wf-search-deep/` contains `adapters.json`, `agent.json`, `extension.json`, `search-providers.json`, and 10 skills (comment-reader, evidence-scoring, media-download, platform-bilibili, platform-instagram, platform-tiktok, platform-wechat, platform-x, platform-xiaohongshu, platform-youtube, search-provider-router, source-discovery, video-asr, video-understanding). It is **not** in the ownership manifest.
- **Impact**: This extension is not tracked by the update model. It may be a development artifact or a new extension that should be in the manifest.
- **Evidence**: `find extensions/wf-search-deep -type f` → 22 files.
- **Recommendation**: Add to ownership manifest as `optionalOwned` or document its purpose.

**F-014 — `benchmarks/harness-intelligence-092/` is a benchmark suite**
- **Fact**: `benchmarks/harness-intelligence-092/` contains benchmark definitions (b1-b6), `manifest.json`, `README.md`, `evidence-template.md`, `report.schema.json`, and `results/harnessbench-local-v0.2.json`.
- **Impact**: This is a benchmark suite for harness intelligence. It is not in the ownership manifest.
- **Evidence**: `find benchmarks -type f` → 15 files.
- **Recommendation**: Add to ownership manifest or document as development-only.

**F-015 — `test-results/` and `verification-screenshots/` at repo root**
- **Fact**: These directories contain test artifacts. Not in ownership manifest.
- **Impact**: May be stale.
- **Evidence**: `ls test-results/`, `ls verification-screenshots/`.
- **Recommendation**: Add to `.gitignore` or clean up.

**F-016 — `3080.md` (22 KB) and `3080-xianyu-cover.png` (1.9 MB) at repo root**
- **Fact**: These appear to be unrelated artifacts (possibly from a different project).
- **Impact**: Pollution of the repo root.
- **Evidence**: `ls -la 3080.md 3080-xianyu-cover.png`.
- **Recommendation**: Move to `docs/` or delete.

**F-017 — `Harness/scripts/lib/wf-search.mjs` is dirty in git**
- **Fact**: `git status` shows `M Harness/scripts/lib/wf-search.mjs` — the file is modified but not committed.
- **Impact**: The dirty state is not explained in this review. It may be part of an in-progress task.
- **Evidence**: `git status --porcelain` shows ` M Harness/scripts/lib/wf-search.mjs`.
- **Recommendation**: Investigate the dirty change before publishing.

### P2 (additional findings from subagent audits)

These findings were identified by the parallel subagent audits (commands/skills, templates/generator parity) and added after the initial review.

**F-018 — CRLF drift in `.claude/agents/` and `.opencode/agents/` not covered by mirror gate**
- **Fact**: 3 agent files in each of `.claude/agents/` and `.opencode/agents/` have CRLF line endings in the runtime while the template uses LF. After CRLF normalization (`tr -d '\r'`), the MD5 hashes are identical — this is byte-level drift, not content drift.
  - `.claude/agents/architect.md` (template 790 bytes vs runtime 819 bytes)
  - `.claude/agents/docs-researcher.md` (1405 vs 1444)
  - `.claude/agents/reviewer.md` (1052 vs 1084)
  - Same pattern in `.opencode/agents/`
- **Impact**: `check-script-mirrors.mjs` only covers 5 framework scripts (`wf-update-check.mjs`, `scan-clean.mjs`, `sync-host-global.mjs`, `validate-harness.mjs`, `wf-update-runner.mjs`). The agent files are NOT covered. Any future byte-for-byte comparator will report these as drift even though content is identical.
- **Evidence**: `diff -rq templates/common/.claude .claude` shows 3 files differ; `tr -d '\r'` comparison shows identical MD5 after normalization.
- **Recommendation**: Extend `check-script-mirrors.mjs` to cover `.claude/agents/*.md` and `.opencode/agents/*.md` with CRLF normalization. Or add a `.gitattributes` rule to force LF for these files.

**F-019 — `check-script-mirrors.mjs` only covers 5 framework scripts — coverage gap**
- **Fact**: The local mirror parity gate (`scripts/check-script-mirrors.mjs`) only checks 5 files: `wf-update-check.mjs`, `scan-clean.mjs`, `sync-host-global.mjs`, `validate-harness.mjs`, `wf-update-runner.mjs`. All other scripts, commands, skills, and agents are not covered by this gate.
- **Impact**: Drift in any other file between dogfood runtime and template is not detected by this gate. The only protection is the remote manifest checksum (`check-update-mirrors.mjs`), which requires network access.
- **Evidence**: `scripts/check-script-mirrors.mjs` lines: `MIRROR_PAIRS = ['wf-update-check.mjs', 'scan-clean.mjs', 'sync-host-global.mjs', 'validate-harness.mjs', 'wf-update-runner.mjs']`
- **Recommendation**: Extend `MIRROR_PAIRS` to include all framework scripts, or use a recursive comparison of `Harness/scripts/` and `templates/common/Harness/scripts/`.

**F-020 — `.agents/skills/` is generated at install time, not stored in template**
- **Fact**: `templates/common/.agents/` does not exist. `.agents/skills/` is generated by `src/generator.js:536-543` `createCodexSkillMirrors()` at install time, mirroring `.claude/skills/*` → `.agents/skills/*`.
- **Impact**: This is by design, but it means the template tree is incomplete — the `.agents/` tree only exists in installed runtimes. This can confuse contributors who expect the template to be a complete mirror.
- **Evidence**: `ls templates/common/.agents` → "No such file or directory"; `src/generator.js:536-543` `createCodexSkillMirrors()`.
- **Recommendation**: Document this clearly in the README or add a `.gitkeep` + comment in `templates/common/.agents/` explaining it's generated.

**F-021 — 2 runtime-only skills not in ownership manifest**
- **Fact**: `.claude/skills/improve-codebase-architecture/` and `.agents/skills/make-interfaces-feel-better/` are user-added skills not in the template or ownership manifest.
- **Impact**: These skills will be preserved during updates (not overwritten), but they are not tracked by the ownership model. They are effectively "unmanaged" by the framework.
- **Evidence**: `diff -rq templates/common/.claude .claude` shows "Only in .claude/skills: improve-codebase-architecture"; `ls .agents/skills/make-interfaces-feel-better` exists but not in template.
- **Recommendation**: Either (a) add these skills to the template and ownership manifest, or (b) document them as user-local skills that are intentionally not managed by the framework.

**F-022 — `wf-research` missing from `command-surface.json` registry**
- **Fact**: `Harness/specs/runtime/command-surface.json` lists 18 commands. The physical directories have 19. `wf-research` is NOT in `command-surface.json` (`grep -c "wf-research" Harness/specs/runtime/command-surface.json` → `0`). Yet:
  - `.claude/commands/wf-research.md` exists (107 lines)
  - `.opencode/commands/wf-research.md` exists (byte-identical mirror)
  - `.claude/skills/wf-research/SKILL.md` exists
  - `.agents/skills/wf-research/SKILL.md` exists
  - `tests/wf-research.test.js` exists
  - `Harness/scripts/wf-research.mjs` exists
- **Impact**: The surface checklist at `.claude/commands/wf-command-create.md:21-27` says all wf-* commands MUST be registered in `command-surface.json`. `wf-research` violates this contract. Any tool that reads `command-surface.json` to enumerate commands will miss `wf-research`.
- **Evidence**: `grep -c "wf-research" Harness/specs/runtime/command-surface.json` → `0`; `.claude/commands/wf-research.md:1` exists; `.claude/commands/wf-command-create.md:21-27` states the registration requirement.
- **Recommendation**: Add `wf-research` to `command-surface.json` with classification `direct` and `taskCapsulePolicy: none` (consistent with its delegation pattern). Or remove it if it's intentionally deprecated.

**F-023 — Three dead scripts with no runtime consumer**
- **Fact**: Three scripts have zero references from any `.claude/`, `.opencode/`, `.agents/`, or `.codex/` command or skill file:
  1. `Harness/scripts/archive-tasks.mjs` — functionality absorbed into `task-state.mjs archive`
  2. `Harness/scripts/a2a-terminal.mjs` — no consumer anywhere
  3. `Harness/scripts/l2-cache-telemetry.mjs` — only used by `tests/l2-cache-telemetry.test.js`
- **Impact**: These scripts are framework-owned (listed in `ownership.manifest.json` with `overwrite: safe`) and will be shipped to all installed runtimes, but they serve no purpose. They increase update surface area and confuse contributors.
- **Evidence**: `grep -rl "archive-tasks" .claude .opencode .agents .codex` → no matches; `grep -rl "a2a-terminal" .claude .opencode .agents .codex` → no matches; `grep -rl "l2-cache-telemetry" .claude .opencode .agents .codex` → no matches (only test file).
- **Recommendation**: Either (a) delete these scripts and remove from ownership manifest, or (b) document why they're kept (e.g., `l2-cache-telemetry.mjs` for manual diagnostics). If keeping, add a README comment explaining usage.

**F-024 — `.opencode/commands` has 3 frontmatter drifts not enforced by tests**
- **Fact**: `diff -r .claude/commands .opencode/commands` reports exactly 3 drifts, all additive on the `.opencode` side:
  - `wf-command-create.md` — `.opencode` adds `description:` frontmatter
  - `wf-help.md` — `.opencode` adds `description:` frontmatter
  - `wf-max.md` — `.opencode` adds `agent: build` frontmatter
- **Impact**: This drift is expected by design (OpenCode runtime parses command frontmatter differently). However, it is NOT enforced by any test. If someone accidentally edits `.claude/commands/wf-max.md` to add frontmatter, or removes it from `.opencode/commands/wf-max.md`, nothing will catch it.
- **Evidence**: `diff -r .claude/commands .opencode/commands` output; `tests/anti-drift.test.js` does not test command parity.
- **Recommendation**: Add a test in `tests/anti-drift.test.js` that verifies `.claude/commands/*.md` and `.opencode/commands/*.md` differ ONLY in expected frontmatter (not body content). Or document the expected drift pattern in the test.

**F-025 — `.claude/agents` vs `.opencode/agents` differ in frontmatter schema (19 files)**
- **Fact**: All 19 agent files differ between `.claude/agents/` and `.opencode/agents/`. Root cause: different frontmatter schemas, not content drift. Example (`architect.md`):
  ```
  .claude/agents/architect.md:
  ---
  name: architect
  description: ...
  tools: Read, Grep, Glob
  model: sonnet
  ---

  .opencode/agents/architect.md:
  ---
  description: ...
  mode: subagent
  permission:
    edit: deny
    bash: deny
    task: deny
    websearch: deny
    webfetch: deny
  ---
  ```
- **Impact**: This is structural (Claude uses `tools:`+`model:`; OpenCode uses `mode:`+`permission:`). Same 19 role names, same body text, but different schemas per runtime. The body content is identical; only frontmatter differs.
- **Evidence**: `diff -rq .claude/agents .opencode/agents` shows 19 files differ; inspection of `architect.md` shows different frontmatter schemas.
- **Recommendation**: Document this structural drift in `README.md` or `Harness/specs/runtime/`. Add a test that verifies body content (after frontmatter removal) is identical between the two trees.

**F-026 — `tests/anti-drift.test.js` coverage gap**
- **Fact**: `tests/anti-drift.test.js` only checks:
  1. Name-set equality of `.claude/skills` and `.agents/skills` (line 54)
  2. Byte-equality of `wf-ui` SKILL.md between the two trees (line 139)
  3. Canonical 9-step flow for `wf-update` across all four surface copies (lines 83-86)
  4. Canonical `wf-ui` across all four surface copies (lines 117-120)
- **Impact**: No test exists that verifies:
  - `.claude/commands/*.md` vs `.opencode/commands/*.md` parity
  - `.claude/agents/*.md` vs `.opencode/agents/*.md` parity (body content)
  - `.agents/skills/*/SKILL.md` vs `.claude/skills/*/SKILL.md` byte-equality (except `wf-ui`)
- **Evidence**: `tests/anti-drift.test.js` lines 54, 139, 83-86, 117-120.
- **Recommendation**: Extend `tests/anti-drift.test.js` to cover the missing parity checks. At minimum, verify that skill body content is byte-identical across all surface copies.

---

## 4. Simplification table

| Item | Category | Reason | Precondition for change |
|------|----------|--------|--------------------------|
| `.claude/commands/*.md` + `.opencode/commands/*.md` | **必须保留** | Both are consumed by their respective hosts; removing either breaks that host | n/a |
| `.agents/skills/*/SKILL.md` | **必须保留** | Codex compat mirror; consumed by Codex | n/a |
| `.claude/agents/*.md` + `.opencode/agents/*.md` | **必须保留** | Both are consumed by their respective hosts | n/a |
| `Harness/scripts/task-state.mjs` | **必须保留** | Core task lifecycle | Refactor into `lib/` modules before changing |
| `Harness/scripts/wf-ui-control.mjs` | **必须保留** | Core A2A control plane | Refactor into `lib/` modules before changing |
| `Harness/scripts/validate-harness.mjs` | **必须保留** | Core validator | n/a |
| `Harness/ownership.manifest.json` | **必须保留** | Source of truth for update model | n/a |
| `templates/common/` | **必须保留** | Canonical scaffold source | n/a |
| `src/index.js` + `src/generator.js` | **必须保留** | Generator | n/a |
| `Harness/a2a/action-registry.json` | **必须保留** | Static framework action contract consumed by the control plane | Keep framework-owned and document contract |
| `Harness/a2a/workflow-map.json` | **暂不能删** | Backend-owned runtime topology; update ownership is not explicit | Verify dry-run/update behavior, then add explicit preserve or framework-owned rule |
| `Harness/templates/*.template.md` | **必须保留** | Artifact templates consumed by agents | Rename directory to avoid confusion |
| `Harness/scripts/memory-context.mjs` (top-level) | **必须保留** | Public CLI entry point used by commands and skills | Document CLI contract; do not delete |
| `Harness/scripts/research-policy.mjs` (top-level) | **必须保留** | Public CLI entry point used by commands and skills | Document CLI contract; do not delete |
| `.tmp-*` files at root | **可直接删** | Debug artifacts | None — verify not referenced |
| `Harness/scripts/tmp-wfui-out.log` | **可直接删** | Debug artifact | None |
| `Harness/scripts/debug-memory-fixture2/` | **可删但需迁移** | Debug fixture | Move to `tests/fixtures/` if needed |
| `3080.md` + `3080-xianyu-cover.png` | **可直接删** | Unrelated artifacts | Verify no references |
| `nul` (0-byte) | **可直接删** | Empty file | None |
| `debug.log` | **可直接删** | Debug log | None |
| `test-results/`, `verification-screenshots/` | **可直接删** | Test artifacts | Verify not referenced |
| `Harness/wf-browser/` (non-README) | **暂不能删** | Unknown ownership | Inventory first |
| `extensions/wf-search-deep/` | **暂不能删** | Unknown ownership | Inventory first |
| `benchmarks/` | **暂不能删** | Unknown ownership | Inventory first |
| `.claude/skills/improve-codebase-architecture/` | **必须保留** | Active skill | Add `.agents/` mirror or document Claude-only |
| `.agents/skills/make-interfaces-feel-better/` | **必须保留** | Active skill | Add `.claude/` mirror or document Codex-only |

---

## 5. Highlights

1. **Ownership manifest is explicit and machine-readable** — `ownership.manifest.json` with `preserve`/`merge`/`frameworkOwned`/`optionalOwned`/`moves`/`acceptedConflicts`/`releaseNotes` is the single strongest architectural feature. It makes the update model auditable.

2. **CLAUDE.md is a thin router** — It does not duplicate workflow logic; it routes to `Harness/MEMORY.md`, `Harness/README.md`, and the specs. This is correct.

3. **Task capsule model is deterministic** — `Harness/tasks/*/STATE.json` is the source of truth; `INDEX.json` is derived. `task-state.mjs` is the single writer. This is correct.

4. **Memory is layered** — `startup-hints.md` is the L2 lightweight digest (5-10 hints); detailed memory lives in `Harness/memory/*.md`. This respects context budget.

5. **Tests are extensive** — ~53 test files cover the runtime, validators, mirrors, memory, and wf-search. The CI matrix is comprehensive.

6. **`wf-search` hardening is well-documented** — The 0.9.5 release notes document HTML-escaping, symlink validation, and bounded stdin. This is a sign of good engineering hygiene.

7. **Direct/compat commands are clearly marked** — CLAUDE.md and Harness/README.md both list the 11 direct/compat commands explicitly. This is correct.

8. **A2A state is explicitly separated from control** — CLAUDE.md says state files are diagnostic only; typed CLI is the control surface. This is correct *in principle*. (W7: `action-registry.json` is correctly framework-owned static contract; only `workflow-map.json` needs separate ownership verification — see F-004b.)

9. **Public CLI wrappers are intentional layering** — (W7) The top-level `memory-context.mjs`, `research-policy.mjs`, and `wf-search.mjs` are public CLI entry points that delegate to `lib/` modules. This is the same pattern used across the codebase and should be documented, not removed (see F-002 correction).

---

## 6. Drift check

| Goal | Status | Evidence |
|------|--------|----------|
| 无感记录 (seamless recording) | ✓ | Task capsules auto-record; `task-state.mjs` is the single writer |
| 最小 context 暴露 (minimal context exposure) | ✓ | `startup-hints.md` is L2 digest; `context-budget.mjs` enforces budgets |
| 可回溯协同 (traceable coordination) | ✓ | `Harness/a2a/` has full event log; `task-state.mjs history` provides archive |
| 单一写入者 (single writer) | ✓ | `task-state.mjs` is the single task writer; `wf-ui-control.mjs` is the single A2A writer |
| 模板可复制 (templates are copyable) | ✓ | `templates/common/` is the canonical source; `generator.js` produces the scaffold |

**Drift items** (W7 corrected):
- `workflow-map.json` is absent from the ownership manifest and scaffold template while CLAUDE.md says it is backend-owned diagnostic storage (F-004b); current updater code skips files absent from the remote checksum set, so this is a documentation/contract gap rather than an observed overwrite risk. (`action-registry.json` is correctly framework-owned — see F-004a.)
- ~~Duplicate top-level scripts create two entry points (F-002)~~ — W7 correction: top-level scripts are public CLI entry points, not duplicates. This is not drift.
- `.claude/skills/improve-codebase-architecture/` and `.agents/skills/make-interfaces-feel-better/` are unmirrored (F-005, F-006) — conditional drift, depends on intended cross-runtime support.

---

## 7. Minimal target architecture (W7 corrected)

Without adding new abstractions, the minimal refactor route is:

1. **Resolve mirror gate baseline (P0)** — Record baseline exception OR sync zingspark mirror. Gate: `scripts/check-update-mirrors.mjs` passes OR baseline exception is explicitly recorded in release notes.
2. **Document `workflow-map.json` runtime-only ownership (P3)** — Record that it is backend-owned runtime state absent from the scaffold/update checksum set, and preserve the current skip behavior. Add a manifest rule only if the project intentionally changes that contract.
3. **Document public CLI wrappers (P1)** — Add API contract documentation for `memory-context.mjs`, `research-policy.mjs`, `wf-search.mjs` in `Harness/scripts/README.md`. Do **not** delete these files. Gate: documentation exists; no functional change.
4. **Document or mirror orphan skills (P2, conditional)** — Add `.agents/skills/improve-codebase-architecture/SKILL.md` OR document Claude-only intent. Add `.claude/skills/make-interfaces-feel-better/SKILL.md` OR document Codex-only intent. Gate: `validate-harness.mjs --strict` passes OR intent documented.
5. **Delete orphan debug artifacts (P2)** — Remove `.tmp-*`, `tmp-wfui-out.log`, `debug-memory-fixture2/`, `nul`, `debug.log`, `3080.md`, `3080-xianyu-cover.png`, `test-results/`, `verification-screenshots/`. Gate: `git status` is clean.
6. **Refactor monolithic scripts (P2, deferred)** — Extract `lib/` modules for `wf-ui-control.mjs` and `task-state.mjs`. Defer to dedicated task with explicit scope. Gate: `node --test tests/*.test.js` passes.
7. **Inventory unknown directories (P3)** — `Harness/wf-browser/`, `extensions/wf-search-deep/`, `benchmarks/`, `Harness/specs/cooperation/`. Gate: all directories are in the ownership manifest or `.gitignore`.

**Order dependency**: Step 1 must come first (release blocker). Steps 2-5 are independent. Step 6 is deferred. Step 7 is a prerequisite for future cleanups.

**W7 note**: The original route included "move A2A state to `preserve`" and "resolve top-level script duplication" as P1/P2 items. Both are corrected: (a) `workflow-map.json` is runtime-only and currently skipped because it is absent from the remote checksum set; (b) top-level wrappers are public CLI and should be documented, not deleted.

---

## 8. Gate report (W7: incomplete gates marked)

| Gate | Result | Notes |
|------|--------|-------|
| `scripts/check-update-mirrors.mjs` | **FAIL — release-policy baseline** | 2/4 mirrors fail (zingspark legacy). Recorded as baseline exception in F-001. The canonical LiWeny16 mirror passes; only the legacy zingspark mirror fails. |
| `node --test tests/*.test.js` | **INCOMPLETE** | Not run in this review. Requires `npm install` first. Must be run before any release decision. |
| `node tests/e2e-wf-scripts.test.mjs` | **INCOMPLETE** | Not run. E2E coverage status unknown. Must be run before any release decision. |
| `node --test tests/cli-smoke.test.js` | **INCOMPLETE** | Not run. CLI smoke coverage status unknown. Must be run before any release decision. |
| `node --test tests/pack-smoke.test.js` | **INCOMPLETE** | Not run. Pack smoke coverage status unknown. Must be run before any release decision. |
| `node templates/common/Harness/scripts/validate-harness.mjs --strict` | **INCOMPLETE** | Not run. Validator coverage status unknown. Would be fast but may fail on dirty tree. |
| `node scripts/build-version.mjs --check` | **INCOMPLETE** | Not run. Version check status unknown. Would be fast. |

**Baseline exceptions**:
1. **Mirror gate failure is a release-policy baseline** (F-001) — The zingspark legacy mirror drift is a pre-existing condition, not a regression. Publishing 0.9.6 while this gate fails violates release policy, but the failure itself is not a code defect.
2. **Dirty git tree (137 files)** is a pre-existing condition, not caused by this review. It must be resolved before any gate can be meaningfully run.

**W7 note**: Gates marked **INCOMPLETE** were not run in this review due to environment constraints (no `npm install`, dirty tree). Their status is unknown — they may pass or fail. **Do not treat "not run" as "pass" or "fail"**. These must be run before any release decision.

---

## 9. Acceptance checklist

| AC | Status | Evidence |
|----|--------|----------|
| AC-001 | ✓ | Inventory in §1 |
| AC-002 | Partial | Call chains documented in §1; `file:line` evidence in findings |
| AC-003 | ✓ | Ownership matrix in §2 |
| AC-004 | ✓ | Findings F-001..F-026 with evidence; F-004 split into F-004a/F-004b |
| AC-005 | Partial | Context exposure reviewed; resume reviewed; hook semantics reviewed; cross-session resume documented |
| AC-006 | ✓ | Simplification table in §4 |
| AC-007 | ✓ | Highlights in §5; drift in §6 |
| AC-008 | Partial | Gate report in §8 is explicit; unrun tests/validators remain INCOMPLETE |
| AC-009 | ✓ | Prioritized route in §7 |
| AC-010 | ✓ | No business code, command, skill, hook, template, or test modified |

---

## 10. W7 Correction Log

This section records the W7 evidence corrections applied to this review. The verdict remains **YELLOW** — the corrections change the severity/classification of findings, not the release decision.

| Finding | Original | W7 Correction | Rationale |
|---------|----------|---------------|----------|
| F-001 | P0 — Mirror gate failing | P0 — Release-policy baseline | The failure is a pre-existing condition (legacy zingspark mirror), not a code defect. Publishing 0.9.6 with this failure violates policy, but the failure itself is not a regression. |
| F-002 | P1 — Duplicate scripts, possible deletion | P1 — Public CLI wrappers, documentation task | The top-level `memory-context.mjs` and `research-policy.mjs` are public CLI entry points invoked by commands. They cannot be deleted. The `lib/` split is the implementation pattern. Action: document the API contract. |
| F-003 | P1 — Monolithic scripts | P2 — Deferred technical debt | The monolithic structure is a known trade-off for runtime simplicity. Refactoring requires a dedicated task with explicit scope. |
| F-004 | P1 — Both files need `preserve` | Split: F-004a (action-registry) is correctly `frameworkOwned`; F-004b (workflow-map) is runtime-only, absent from the manifest/template, and currently skipped by updater checksum logic | `action-registry.json` is a static framework contract. `workflow-map.json` is backend-owned by CLAUDE.md; the remaining work is documentation, not a demonstrated overwrite bug. |
| F-005 | P1 — Missing `.agents/` mirror | P3 — Conditional (depends on intended cross-runtime support) | If the skill is intentionally Claude-only, no mirror is needed. Confirm intent with repo owner. |
| F-006 | P1 — Missing `.claude/` mirror | P3 — Conditional (depends on intended cross-runtime support) | Inverse of F-005 — same conditional nature. |
| Gate report | "Not run" for tests/e2e/validator | **INCOMPLETE** for unrun tests | "Not run" is ambiguous. "INCOMPLETE" explicitly indicates the gate was not executed and its status is unknown. Must be run before release decision. |

**W7 constraint compliance**:
- No business code, manifest, skill, hook, or file was modified or deleted.
- Only REVIEW.md, PROGRESS.md, REFERENCES.md, and STATE.json were updated.
- All corrections are evidence-driven with file:line or command references.
- Verdict remains YELLOW.
