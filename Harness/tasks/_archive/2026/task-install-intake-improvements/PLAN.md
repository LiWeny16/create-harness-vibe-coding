# install-intake-improvements - PLAN

Task-level implementation plan and evidence. Main agent writes after second planning; implementer reads before coding.

## Goal

Improve the scaffold so both agent-link usage and CLI usage guide installation through root scanning, safe existing-project handling, `Harness/` conflict handling, Codex-friendly optional selection, and additional popular optional capability prompts.

## Acceptance Criteria

- [x] Agent-link README prompt tells agents to scan the project root before asking install intake questions.
- [x] Agent-link intake asks whether `Harness/` already exists and how to handle it before editing.
- [x] Intake no longer routes Harness docs through `docs/`; generated Harness guidance lives under `Harness/` except root agent entry files and tool-discovery folders.
- [x] CLI interactive install offers checkbox-style optional workflow selection, not only typed `--with`.
- [x] Optional install catalog can represent common external capability suggestions such as Superpowers, Caveman, agent research, and code graph without silently installing unknown packages.
- [x] Existing tests cover the changed behavior and pass.
- [x] Agent-link README prompt is short; detailed install, upgrade, root-scan, and optional recommendation rules live in README and `Harness/SETUP.md`.
- [x] External recommendations use GitHub source links only; the scaffold does not maintain third-party install instructions.

## Scope

Allowed write set:
- `README.md`
- `README-CN.md`
- `src/generator.js`
- `src/prompts.js`
- `templates/common/**`
- `templates/optional/**`
- `tests/**`
- `Harness/tasks/install-intake-improvements/**`
- `Harness/PROGRESS.md`
- `package.json` version field for patch release

Forbidden:
- unrelated package metadata churn
- destructive overwrite behavior
- changing project source outside scaffold generator/templates/tests

## Loaded Context

- `CLAUDE.md`
- `Harness/MEMORY.md`
- `Harness/README.md`
- `Harness/PROGRESS.md`
- `Harness/WF.md`
- `.agents/skills/wf/SKILL.md`
- `.agents/skills/wf-readme/SKILL.md`
- `.claude/skills/subagent-orchestrator/SKILL.md`
- `Harness/extension.md`
- root `README.md`

## Subagent Dispatch

| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| planner | bounded-pass fallback | root docs, src, tests | none | Done |
| architect | bounded-pass fallback | generator, prompts, templates | none | Done |
| reviewer | bounded-pass fallback | final diff and tests | none | Done |

Reason for fallback: this Codex tool policy exposes multi-agent tools but forbids spawning unless the user explicitly requests subagents/parallel agent work. The project WF requirement is therefore satisfied through separate bounded read-only passes.

## Subagent Synthesis

Agents used: bounded-pass planner, bounded-pass architect, bounded-pass reviewer.

Findings accepted:
- Root README agent-link prompt only says to ask intake questions; it does not explicitly require scanning root files before asking. This explains why the downstream agent asked generic questions without inspecting the project.
- `templates/common/SETUP.md` has an "Existing Project Bootstrap Sequence" that says to scan project facts, but that instruction is reached after scaffolding; the one-sentence install prompt and README intake section do not front-load it strongly enough.
- CLI interactive mode only asks project name and target directory. Optional workflows are available only through typed flags (`--with`, `--preset`, `--without`) or `--list-options`.
- The generated project already maps harness-owned docs into root `Harness/`, but template source files still live under `templates/common/docs/**` and optional workflows under `templates/optional/**/docs/workflows/**`, which keeps the source model confusing.
- Codex support is partial: `.codex/` and root `commands/` are templated, but only `wf-max` and `wf-review` Codex command files are present and README does not advertise the Codex surface.
- External popular skill ecosystems should be selectable as recommendations, not silently installed, because the scaffold does not vendor Superpowers, Caveman, agent-research, or codegraph assets.

Findings rejected:
- Replacing `.claude/` with `Harness/.claude/` is rejected because Claude Code discovers agents, skills, commands, and settings from root `.claude/`.
- Automatically installing unknown third-party skills during scaffold generation is rejected because it would add network/tool side effects and unclear trust boundaries.

Conflicts:
- The user wants everything except `CLAUDE.md`/`AGENTS.md` under `Harness/`; tool discovery folders `.claude/`, `.codex/`, and root `commands/` must stay at root for Claude/Codex discovery. The docs should state this exception explicitly.

Decisions:
- Add tests first for root-scan wording, `Harness/` conflict intake, external recommendation catalog entries, Codex command generation, and template-source `Harness/` paths.
- Add interactive checkbox/multiselect prompts for local workflows and external recommendations. Keep non-interactive flags for automation.
- Add an `externalOptions`/`--recommend` path that records recommendations in `Harness/SETUP.md` and `.harness-version` without creating third-party files.
- Move template source docs from `templates/common/docs/**` to `templates/common/Harness/**` and optional workflow sources from `docs/workflows` to `Harness/workflows`; remove new-scaffold reliance on `docs/**` mappings entirely.
- Do not add `npx` update/sync for installed Harness projects. Existing-project updates need agent-mediated conflict handling for `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, and user-modified Harness docs, so the supported path remains `/wf-update` or `node Harness/scripts/wf-update-check.mjs`.
- Keep the pasted agent-link prompt to a single short instruction and move the operational requirements into README/SETUP so downstream agents must read the guide instead of parsing a long sentence.
- Treat Superpowers, Caveman, agent-research, and CodeGraph as recommendation-only GitHub links after scanning already-installed skills/plugins/rules; do not vendor or document third-party install commands.

Residual risk:
- Interactive prompt behavior is hard to fully automate without a TTY. Tests will cover static prompt wiring, CLI help/list output, and non-interactive recommendation behavior; manual CLI smoke remains useful after implementation.

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `node --test tests/generator.test.js` before implementation | Failed as expected | Red tests caught missing root-scan README wording, `templates/common/Harness`, external recommendations, Codex commands, recommendation recording, and stale `.harness-version` sources |
| `node scripts/build-version.mjs` | Passed | Rebuilt `templates/common/.harness-version`; sources now map `Harness/WF.md` from `Harness/WF.md` |
| `node --test tests/generator.test.js` | Passed | Generator regression suite passed; legacy mojibake README-CN assertion replaced by real Chinese test |
| `node --test tests/cli-smoke.test.js` | Passed | 23 passed, 1 existing TTY-only skip |
| `node --test tests/pack-smoke.test.js` | Passed | Confirms package uses `templates/common/Harness/README.md` and optional `Harness/workflows/*`, not `docs/*` |
| `npm test` | Passed | 64 passed, 2 skipped; second skip is legacy mojibake README-CN assertion replaced by real Chinese test |
| `node scripts/build-version.mjs --check` | Passed | `.harness-version` up to date: 59 checksums, 73 sources |
| `node templates/common/scripts/validate-harness.mjs --strict` | Passed | Harness validation passed strict |
| `node tests/e2e-wf-scripts.test.mjs` | Passed | 71/71 |
| legacy WF runtime-interceptor e2e test | Passed | Historical evidence only; runtime-interceptor e2e test was removed by `task-remove-hook-docs`. |
| `rg` for template docs paths | Passed | No `templates/common/docs`, optional `docs/workflows`, or `docs/*` generator mappings remain outside historical task notes |
| `node templates/common/scripts/validate-harness.mjs --strict` after memory write | Passed | Harness validation still passed after recording the `docs/` preference |
| `npm test` after 0.8.1 refinement | Passed | 65 passed, 1 skipped |
| `node scripts/build-version.mjs --check` after 0.8.1 refinement | Passed | `.harness-version` up to date: 56 checksums, 70 sources |
| `node templates/common/scripts/validate-harness.mjs --strict` after 0.8.1 refinement | Passed | Harness validation passed strict |
| `node Harness/scripts/validate-harness.mjs --strict` after 0.8.1 refinement | Passed | Dogfood Harness validation passed strict |
| `npm pack --dry-run` after 0.8.1 refinement | Passed | Tarball preview for `create-harness-vibe-coding@0.8.1` included 80 files |
