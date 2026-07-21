# dogfood-bootstrap — PLAN

## Goal

Dogfood the generated Harness scaffold inside this repository.

## Acceptance Criteria
- [x] Root CLAUDE.md routes through Harness/MEMORY.md and Harness/README.md
- [x] Root MEMORY.md uses correct paths
- [x] Harness strict validation passes
- [x] Repository tests pass

## Scope
Allowed: CLAUDE.md, MEMORY.md, AGENTS.md, .claude/**, Harness/**, tests/.gitkeep
Forbidden: package publish metadata, unrelated source refactors

## Subagent Dispatch
| Agent | Mode | Read Set | Write Set | Status |
|-------|------|----------|-----------|--------|
| main agent | Serial Write | root docs, generator dry-run, templates | Harness/, .claude/, CLAUDE.md, MEMORY.md | Verified |

## Verification
| Check | Result |
|-------|--------|
| Generator dry-run + skip | Pass |
| Strict validator | Pass |
| npm test | Pass (56→57→58) |
| git diff --check | Pass |
