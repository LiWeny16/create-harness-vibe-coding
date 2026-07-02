# update-mechanism — PLAN

## Goal

Design a version management and update system for the Harness scaffold (`create-harness-vibe-coding`). Existing projects need a safe way to update their Harness runtime files when the scaffold evolves.

## Key Design Questions

1. **Version tracking**: How does an existing project know its current harness version? Where is the version stored?
2. **Update command**: What's the UX? `npx create-harness-vibe-coding update`? A `/wf update skills` slash command?
3. **Safety / conflict resolution**: How to handle modified files, local customizations, and merge conflicts?
4. **Scope**: What gets updated? Only Harness/* and .claude/*? What about root CLAUDE.md, MEMORY.md?
5. **Release channel**: npm versions? Git tags? How does the updater know what's available?
6. **WF integration**: How does this integrate with wf-mode? Auto-check on session start?

## Expected Output

A design document covering:
- Version file format and location
- Update command UX (CLI + slash command)
- Update scope and safety rules
- Conflict detection and merge strategy
- WF mode integration (auto-check, update-triggered task re-evaluation)
- Template changes needed
- Generator changes needed
