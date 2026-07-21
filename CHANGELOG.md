# Changelog

## [0.8.11] - 2026-07-21

- Move repository metadata, README links, and Harness update sources to `LiWeny16/create-harness-vibe-coding`.
- Prepare personal-repo maintenance as the canonical public source.

## [0.8.10] - 2026-07-21

- Move Harness update reminders to startup-only hooks for Claude, Codex, and OpenCode.
- Harden `wf-update-check.mjs` so stable updates prefer a usable GitHub release, ignore prerelease generators, and fall back to `main` when release metadata is stale.
- Add validator, generator, E2E, pack-smoke, and CI/pre-push coverage for startup-only update checks.
- Reject drive-letter paths in Harness update/remove/clean scripts across platforms.

## [0.8.9] - 2026-07-17

- Add safe recovery for older Harness installs missing `wf-update-check.mjs`.
- Tighten update-check JSON output and WF-AUTO hook output to keep default agent context small.
- Add L2 startup memory hints and L3 memory route indexing to generated Harness installs.
- Add symlink write-path protection and P0 regressions for scaffold safety.
- Include the README icon in the published npm package.

## [0.5.0] - 2026-06-25

- `/wf-learn` command: force memory learning cycle (context-master → memory-master → project + global memory).
- Fix auto-trigger: replace unreliable "3x failure" rule with mandatory closeout gate in wf-mode.
- Register `/wf-learn` in all routers (CLAUDE.md, MEMORY.md, README.md).

## [0.4.3] - 2026-06-25

- Add CHANGELOG.md with full version history (0.1.4 → 0.4.2).
- Create git tags v0.3.0–v0.4.2 and GitHub Releases for all major versions.
- Bump harness-version to 0.4.2.

## [0.4.2] - 2026-06-25

- Simplify CLAUDE.md Section 7: route to WF.md/WF-MAX.md instead of inline dispatch rules.

## [0.4.1] - 2026-06-25

- CEO must not write code directly in `/wf` or `/wf-max` mode — delegate only.
- Reinforce CEO constraint in WF-MAX.md.

## [0.4.0] - 2026-06-25

- `/wf <task/mission>`: command now accepts a required task argument.
- `/wf-max [task]`: renamed from `/wf max`, accepts an optional task argument.
- Remove `wf-mode` as a standalone slash command (skill still handles natural-language triggers).
- CEO must not call `EnterPlanMode` — delegate planning to `planner` subagents.
- Sync all trigger keywords across CLAUDE.md, Harness docs, validators, and templates.

## [0.3.4] - 2026-06-25

- Fix markdown bold syntax — move punctuation outside `**` markers.
- Full README rewrite: concise, punchy, scannable.
- Sync README EN/CN: agent prompt top, full CN alignment.

## [0.3.3] - 2026-06-24

- WF-MAX cross-reference integrity fix.
- Sync harness dogfood to 0.3.3: version bump, SETUP.md, recompute checksums.

## [0.3.2] - 2026-06-24

- `/wf max`: three-tier enterprise hierarchy (CEO → Managers → Workers).
- Span formula, leaf condition, wave orchestration, manager synthesis protocol.

## [0.3.1] - 2026-06-23

- Fix README-CN mermaid syntax.
- Sync README-CN with English, add mermaid workflow diagram.

## [0.3.0] - 2026-06-23

- PROGRESS.md + tasks/ task capsules.
- WF update mechanism (`/wf update`).
- memory-master and context-master agents.
- Cohesion rule (feature doc < Worker granularity).

## [0.2.1] - 2026-06-22

- WF multi-agent routing with subagent orchestration.

## [0.2.0] - 2026-06-22

- Harness root workflow (`/wf`).
- CLAUDE.md, Harness/ docs structure, and initial agent roster.

## [0.1.10] - 2026-06-21

- Non-invasive harness bootstrap.
- Optional skills catalog.
- `--json` output flag.

## [0.1.9] - 2026-06-21

- Feature versioning: iterate vs new based on 85% overlap rule.

## [0.1.8] - 2026-06-21

- Template Fill Guide in SETUP.md: map every placeholder to expected content.

## [0.1.7] - 2026-06-21

- Skill-discovery guide.
- CLAUDE.md renumbering.
- SETUP.md isolation.

## [0.1.6] - 2026-06-20

- Wire architecture research refs, seed repos, and user-confirmation protocol into harness.

## [0.1.5] - 2026-06-20

- Add `-y`/`--yes` and `-h`/`--help` flags.
- Document agent self-bootstrapping.

## [0.1.4] - 2026-06-20

- Initial public release.
