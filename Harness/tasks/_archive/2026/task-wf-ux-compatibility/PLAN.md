# task-wf-ux-compatibility - PLAN

Compact task record for the WF UX, command compatibility, entry routing, and memory-preflight redesign.

> Task ID: `task-wf-ux-compatibility`

## Goal

- Outcome: reduce `/wf` and `/wf-max` latency, prevent accidental WF entry, make WF commands consistent across Claude Code, Codex, and OpenCode, make `AGENTS.md` a thin `CLAUDE.md` shim, and make memory preflight reliable without slowing direct mode.
- Non-goals: implement the changes in this plan, add general runtime hook enforcement, rewrite Harness architecture, or load detailed memory for every direct task.

## Decisions

- D-001: WF and WF-MAX are opt-in modes only. Complexity, uncertainty, file count, architecture scope, browser/API validation, or repeated failures may require planning/subagents/tests, but must not enter WF unless the user explicitly invokes `/wf`, `$wf`, `/skills wf`, `/wf-max`, `$wf-max`, `/skills wf-max`, or says `wf` / `wf-max`.
- D-002: `/wf` should select the cheapest safe workflow tier instead of always forcing the full role chain. Proposed tiers: `WF-Light`, `WF-Standard`, `WF-Full`.
- D-003: `/wf-max` should mean maximum useful fan-out by default. Preserve strict unconditional fan-out behind an explicit `--strict` flag or phrase such as `strict wf-max`.
- D-004: PLAN/PROGRESS updates stay durable but are batched by phase/wave/failure, not emitted before and after every long command when state did not change.
- D-005: Memory Preflight is mandatory for non-direct work: load `CLAUDE.md`, `Harness/MEMORY.md` index only, then `Harness/README.md`; load detailed `Harness/memory/*` entries only when `MEMORY_PROTOCOL.md` scenario hints match.
- D-006: `/wf-help` must remain a direct command and must not start WF. True non-agent rendering is platform-dependent; where custom commands are prompt templates, keep the prompt minimal and point to a canonical static help artifact.
- D-007: `/wf-update` is reclassified as a direct command for platforms with project command files. Codex has no repo-local direct-command directory in this scaffold, so keep a deliberate compatibility path until a direct Codex command surface exists.
- D-008: `AGENTS.md` remains for Codex discovery but becomes a thin shim that only defers to `CLAUDE.md`.
- D-009: No general WF runtime hook enforcement. Status indicators may be optional, passive, and read-only.
- D-010: Runtime files and `templates/common` must change together; update manifests/checksums after implementation.

## Acceptance

- AC-001: No implicit WF entry remains in runtime or template docs/skills. `rg` checks do not find old auto-trigger phrases outside historical task notes.
- AC-002: Explicit `/wf` has documented risk tiers, including a low-risk fast lane that avoids unnecessary research/architecture/review/reflector passes.
- AC-003: Explicit `/wf-max` applies useful-fanout/overhead filtering by default and documents a strict override.
- AC-004: Task artifacts are compact: default 1-3 ACs, phase-level heartbeats, full matrices only for UI/API/security/data-loss/cross-module risk.
- AC-005: `/wf-update` has direct command files for Claude Code and OpenCode, OpenCode command parity is validated, and Codex compatibility is documented intentionally.
- AC-006: `AGENTS.md` and `templates/common/AGENTS.md` contain only the `CLAUDE.md` deferral shim.
- AC-007: Every common workflow skill/adapter and subagent dispatch path records Memory Preflight or an explicit no-op scenario-hint result before meaningful non-direct work.
- AC-008: `validate-harness.mjs` enforces the new rules: explicit-only WF triggers, slim `AGENTS.md`, direct-command allowlist, OpenCode command parity, and Memory Preflight markers.
- AC-009: Update/remove/scan-clean scripts know the new command files and do not orphan `.opencode/commands` files.
- AC-010: Tests and version metadata are updated so generated installs match the dogfood runtime.

## Scope

Allowed write set:
- Root/runtime routing: `CLAUDE.md`, `AGENTS.md`, `Harness/README.md`, `Harness/WF.md`, `Harness/WF-MAX.md`, `Harness/context-loading.md`, `Harness/subagents.md`, `Harness/agent-workflow.md`, `Harness/MEMORY_PROTOCOL.md`, `Harness/SETUP.md`
- Skills/commands: `.claude/commands/*`, `.opencode/commands/*`, `.claude/skills/*/SKILL.md`, `.agents/skills/*/SKILL.md`, optional workflow skill templates as needed
- Tooling: `Harness/scripts/validate-harness.mjs`, `Harness/scripts/scan-clean.mjs`, `Harness/scripts/wf-remove.mjs`, `Harness/scripts/wf-update-check.mjs` if classification changes
- Scaffold source: matching `templates/common/**`, including hidden `.claude`, `.agents`, `.opencode`, scripts, and manifests
- Generator/tests/docs: `src/generator.js`, `src/index.js`, `scripts/build-version.mjs`, `tests/*`, `README.md`, `README-CN.md`

Forbidden:
- Direct edits to detailed memory contents unless this implementation discovers a real durable lesson.
- General hook enforcement for WF/WF-MAX.
- Removing `AGENTS.md` outright.
- Treating Codex support as identical to Claude/OpenCode when the command surfaces differ.

## Context

- Loaded: `CLAUDE.md`, `Harness/MEMORY.md`, `Harness/README.md`, subagent orchestration docs, update skill, relevant command/skill/config/script files, task templates.
- Memory hints: no detailed memory entries loaded; current user feedback is task-local until implementation closeout decides if a durable preference entry is warranted.
- External compatibility facts:
  - OpenCode supports project commands under `.opencode/commands/*.md`, and the markdown content becomes the command template.
  - OpenCode plugins expose session/tool/TUI events, but no installed Harness OpenCode plugin currently renders WF state.
  - Claude Code supports `statusLine` and `subagentStatusLine` command-backed status rows.
  - Codex config supports lifecycle hooks and `tui.status_line`; current public docs describe `tui.status_line` as built-in item identifiers, not arbitrary command-backed WF text.
  - ChatGPT/Codex slash command docs say skills can be invoked with `$` and enabled skills may appear in slash lists.

## Agent Synthesis

| Issue | Agent | Accepted Findings | Plan Impact |
| --- | --- | --- | --- |
| 1. `/wf` and `/wf-max` too slow | explorer `019f6a3e-b605-75d0-b768-fae83c14f037` | Full role chain and unconditional fan-out are the largest overhead sources; dispatch/heartbeat formats are verbose. | Add WF tiers, useful-fanout default, compact artifact cadence. |
| 2. WF must be explicit | explorer `019f6a3e-dcf0-7a33-b2a0-274cf6647dbe` | Many implicit triggers exist in root docs, router, WF docs, context loading, subagents, skills, setup, and validator. | Remove auto triggers and old aliases; keep non-WF planning/subagents for complex work. |
| 3. Commands/platform compatibility | explorer `019f6a3f-060c-7f73-b8d1-a6169a289e09` | `/wf-update` is skill-bound; OpenCode lacks command files; validator assumes every `/wf-*` except help is a skill. | Add direct update commands, revise validator/cleanup/version handling, document Codex compatibility. |
| 4. `AGENTS.md` too heavy | explorer `019f6a3f-2e01-7e73-ab75-27a8e29b41d0` | Root/template `AGENTS.md` duplicate routing and bypass direct mode; Codex still needs a root shim. | Replace with slim `CLAUDE.md` deferral and add validator/tests. |
| 5. Memory not reliably read | explorer `019f6a3f-67bc-7692-81c7-19b179fd3d86` | Memory intent is split; several skill/router paths omit memory; validator does not catch omissions. | Add named Memory Preflight and validate it across workflow adapters/dispatch. |

## Improvement Plan

### Phase 1 - Entry Contract Cleanup

- Replace `AGENTS.md` and `templates/common/AGENTS.md` with a minimal Codex shim:

```md
# AGENTS.md

Codex compatibility entry. Do not put workflow rules, role rules, command tables, or Harness routing here.

Read `CLAUDE.md` and follow it as the single source of startup, routing, workflow, and safety instructions. If this file conflicts with `CLAUDE.md`, `CLAUDE.md` wins.
```

- Update `CLAUDE.md` and template mirror to say:
  - Direct mode is the default when no explicit WF token is present.
  - Complex work may use direct planning, task capsules, tests, and subagents without entering WF.
  - WF modes are explicit only.
- Update setup docs, README docs, generator warnings, and validator wording from "AGENTS entry contract" to "Codex deferral shim".

### Phase 2 - Explicit WF And Speed Tiers

- Rewrite WF triggers in `Harness/README.md`, `Harness/WF.md`, `Harness/context-loading.md`, `Harness/subagents.md`, adapters, setup, validator, and templates.
- Remove or demote these triggers: `workflow mode`, `wk mode`, `long task`, `difficult`, `uncertain`, `stuck`, `repeated failure`, `multi-file`, `architecture-heavy`, `browser-visible`.
- Add tier rules:
  - `WF-Light`: explicit `/wf` plus low-risk scope; planner/test/verifier may be bounded passes; no mandatory research/architecture/cross-review/reflector unless triggered.
  - `WF-Standard`: behavior or multi-file changes; compact ACs, one implementer, one independent validation/review.
  - `WF-Full`: high-risk, cross-layer, security/data-loss, browser/API acceptance, ambiguous architecture, or user asks for full role chain.
  - `WF-Max-Useful`: explicit `/wf-max` with fan-out only where write sets or review lenses are meaningfully independent.
  - `WF-Max-Strict`: explicit strict override preserving current unconditional fan-out contract.
- Reduce required heartbeats to phase start, phase end, failure, blocker, and closeout.

### Phase 3 - Command Surface Compatibility

- Add:
  - `.claude/commands/wf-update.md`
  - `templates/common/.claude/commands/wf-update.md`
  - `.opencode/commands/wf-update.md`
  - `templates/common/.opencode/commands/wf-update.md`
- Reclassify `/wf-update` under Direct Commands in `Harness/README.md`, `Harness/MEMORY.md`, help files, templates, validator, and tests.
- Decide and document Codex behavior:
  - Preferred: if Codex gains repo-local custom commands, add the matching command file.
  - Current compatibility: keep `$wf-update` or document `node Harness/scripts/wf-update-check.mjs` as the Codex path, but do not describe it as a workflow skill.
- Add OpenCode parity checks so every direct WF command intended for OpenCode exists under `.opencode/commands`.
- For `/wf-help`, create or designate a canonical static help artifact and make command prompts minimal. Record platform limitation: custom-command systems that send templates to an LLM cannot guarantee zero-agent rendering unless the runtime provides a static display primitive.

### Phase 4 - Memory Preflight

- Add a named block to root docs, router, context-loading, agent-workflow, and all common workflow skill adapters:

```text
Memory Preflight:
1. Direct simple tasks and /wf-help are exempt.
2. For non-direct work, load CLAUDE.md, Harness/MEMORY.md index only, then Harness/README.md before planning, dispatch, edits/deletes, validation, or peer review.
3. Load Harness/memory/* only when MEMORY_PROTOCOL.md scenario hints match; otherwise record "memory hints: none".
```

- Add `Memory preflight` to dispatch packet and handoff format.
- Add task template fields:
  - `Memory preflight: done | exempt | blocked`
  - `Memory hints: none | <file/path + reason>`
- Extend validator to require the marker in registered Harness workflow skills and optional workflow skills.

### Phase 5 - Passive Status Indicators

- Do not add general WF hooks.
- Claude Code: optional `statusLine`/`subagentStatusLine` can read durable task state and display mode/task/status; no enforcement.
- Codex: optional `tui.status_line` can use built-in status items only; do not promise custom WF text unless Codex exposes a supported command-backed item.
- OpenCode: optional plugin can read task capsule state and render a passive badge or toast if TUI plugin support is adopted; keep it optional because it increases install surface.
- Document that status indicators are advisory UI only; task capsule remains the durable source of truth.

### Phase 6 - Tooling, Tests, And Version Metadata

- Update `validate-harness.mjs` and template copy:
  - direct-command allowlist includes `/wf-help` and `/wf-update`
  - `wf-update` is not required in `commonSkills` if direct command mode is finalized
  - slim `AGENTS.md` required and heavy sections forbidden
  - implicit WF trigger phrases forbidden in active runtime/template docs
  - Memory Preflight marker required for workflow adapters
  - OpenCode direct command parity enforced
- Update `scan-clean`, `wf-remove`, and update checker classifications for new command files and `.opencode/commands`.
- Update generator/build-version so mirrors/checksums/sources include changed command and OpenCode files.
- Update tests:
  - generated scaffold has slim `AGENTS.md`
  - generated scaffold includes direct `wf-update` command files where supported
  - validator fails on missing Memory Preflight
  - validator fails on implicit WF auto-trigger text
  - update/remove/scan-clean handle new command files

## Compatibility Matrix

| Surface | `/wf-help` | `/wf-update` | WF Mode Indicator |
| --- | --- | --- | --- |
| Claude Code | `.claude/commands/wf-help.md`; direct command, minimal prompt/static artifact | add `.claude/commands/wf-update.md` | optional `statusLine`/`subagentStatusLine`, passive only |
| Codex | no repo-local direct command directory in this scaffold; use built-in slash/skill surfaces | compatibility via `$wf-update` or script until direct command support exists | `tui.status_line` built-ins only; no custom WF text promised |
| OpenCode | `.opencode/commands/wf-help.md`; custom command template | add `.opencode/commands/wf-update.md`; consider config `command` fallback | optional plugin/toast/badge only after separate opt-in |

## Verification

- [ ] `rg -n --hidden "automatic WF triggers|Auto-triggering|long task, difficult|long, uncertain|workflow mode|wk mode" CLAUDE.md Harness .claude .agents templates/common`
- [ ] `rg -n --hidden "WF-MAX Role Contract|Key Commands|Harness/MEMORY.md|Harness/README.md" AGENTS.md templates/common/AGENTS.md` returns no forbidden hits except the intended `CLAUDE.md` deferral language.
- [ ] `rg --files .claude/commands .opencode/commands templates/common/.claude/commands templates/common/.opencode/commands`
- [ ] `node Harness/scripts/validate-harness.mjs`
- [ ] `npm test`
- [ ] `npm run build:version`
- [ ] Generate a temp scaffold and verify direct command files, slim `AGENTS.md`, memory preflight markers, and no implicit WF triggers.
- [ ] Manual OpenCode check: typing `/wf` shows intended command entries after `.opencode/commands` changes.

## Risks

- Reducing WF role coverage can miss issues if tier rules are too loose; mitigate with clear risk triggers for `WF-Full`.
- Removing implicit WF without preserving non-WF planning/subagent guidance could weaken complex direct work; keep `agent-workflow.md` and `subagents.md` usable outside WF.
- Removing `wf-update` skill too quickly can break Codex users; keep an intentional compatibility path or script path.
- OpenCode plugin/status work can bloat the scaffold; keep it optional and passive.
- If manifests/checksums are not regenerated, update/remove tools will misclassify cleaned files as modified.
