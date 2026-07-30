# task-global-settings-ownership - PLAN

## Goal

Add global install ownership classes, three-host copy surfaces, and project/global settings layering while preserving project-local task capsules.

## Scope

- Add explicit ownership classes for global install plans: user-owned/preserved project state, project template bridge/state, and global runtime template assets.
- Add project/global settings layering metadata and generated bridge docs.
- Ensure global install copies three-host command/skill surfaces into host-global destinations without symlinks.
- Keep task capsules, progress, project memory, research, and project architecture project-local.
- Add tests and validator guards for these boundaries.

## Decisions

- User confirmed global support for all three hosts: Claude Code, Codex, and OpenCode.
- User confirmed copy mode, not symlink mode.
- Settings precedence: project settings override global settings; global settings contain machine-level defaults only; no secrets in global settings or memory.
- User-owned files are existing non-Harness files at Harness-interest paths and must be preserved or surfaced as conflicts; project template files are generated bridge/state files and may be written only through normal conflict policy.

## Acceptance

- AC-001: global install metadata classifies project state, project template bridge files, global runtime assets, global host copy targets, and user-owned conflict/skip files separately.
- AC-002: project settings and global settings are both present in global mode, with metadata and docs stating project-over-global precedence and no-secret rules.
- AC-003: global install copies Claude Code, Codex, and OpenCode command/skill/agent surfaces to deterministic host-global directories; no symlinks are used.
- AC-004: user-authored files at host-global or project template paths are never silently overwritten; they appear as conflicts/skips with scope-aware guidance.
- AC-005: tests and validators fail if tasks/progress/memory/research/project state move into global runtime or if command/skill host copies disappear.
