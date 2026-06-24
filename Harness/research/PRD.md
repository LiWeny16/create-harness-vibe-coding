# PRD: create-harness-vibe-coding

> **Audience**: AI + future maintainers.
> **Principle**: Keep scaffold behavior explicit, testable, and safe for existing projects.

---

## 1. Why

`create-harness-vibe-coding` gives AI coding agents a compact operating harness for 0-1 product work and existing-project migrations. It standardizes routing, memory, workflow, subagent orchestration, verification, and conflict-safe scaffold installation without prebuilding business code.

## 2. MVP Scope

### v0.1 Must Be Able To

- [x] Generate a root `Harness/` scaffold plus root `.claude/` runtime assets.
- [x] Keep `CLAUDE.md` as a thin root entry with Harness routing, memory triggers, and concise coding rules.
- [x] Preserve existing project files by default and expose `fail`, `skip`, `backup`, and `overwrite` conflict policies.
- [x] Provide Agent-link install guidance for flexible old-project adoption.
- [x] Register workflow, memory, subagent, and README optimization skills in generated projects.

### Explicitly Out of Scope

- Building application business code for the target project.
- Installing marketplace skills or external dependencies automatically.
- Replacing existing `CLAUDE.md`, `AGENTS.md`, or `README.md` without explicit user approval.

## 3. Decision Priorities

1. **Preserve Existing Projects** - Existing files are project facts and must not be silently overwritten.
2. **Harness Routing Clarity** - Agents must know which Harness doc governs each task.
3. **Verifiability** - Scaffold changes must be covered by tests, validator checks, or explicit manual evidence.
4. **Context Discipline** - Load the smallest useful doc set; do not bulk-read the harness.
5. **Simplicity** - Prefer docs-first protocols and small generated assets over hidden automation.

## 4. Users & Usage Scenarios

| User Role | Core Scenario | Frequency | Pain Point |
| --- | --- | --- | --- |
| Solo builder | Start a new AI-assisted project from an idea | recurring | agents jump to code before PRD, architecture, and verification |
| Maintainer | Add Harness to an existing repository | recurring | existing docs, `CLAUDE.md`, and `AGENTS.md` may conflict with scaffold files |
| Coding agent | Follow a GitHub-link installation prompt | frequent | needs safe defaults, conflict questions, and clear routing |

## 5. Acceptance Criteria

- [x] `npm test` covers root `Harness/` mapping, conflict behavior, optional workflows, validator registration, memory triggers, and README language split.
- [x] Generated projects include `Harness/MEMORY.md`, `Harness/README.md`, `Harness/WF.md`, `Harness/subagents.md`, and registered `.claude/skills/*`.
- [x] Existing `CLAUDE.md` and `AGENTS.md` conflicts require user confirmation before merge or replacement.
- [x] README documents both npx install and Agent-link install.
- [x] This repository dogfoods root `Harness/` routing for future agent work.

## 6. Non-Functional Requirements

| Dimension | Target | Measurement |
| --- | --- | --- |
| Safety | No default overwrite of existing root agent/docs files | conflict policy tests |
| Package footprint | Runtime dependencies remain small | `package.json` dependency count |
| Validation | Scaffold structure is machine-checkable | `node Harness/scripts/validate-harness.mjs` |
| Language split | English README has no Chinese text | README language test and `rg` check |

---

## Fill Completion Standard

- [x] MVP and Non-goals are project facts; no template placeholders remain.
- [x] Decision priorities guide tradeoffs.
- [x] Every acceptance criterion is verifiable by test, command, or manual step.
- [x] If implementation diverges from the PRD, update this file before changing code.
