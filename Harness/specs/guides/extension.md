# Extension Contract

Purpose: keep stack-specific agents, skills, and rules compatible with this harness.

Use during setup whenever adding assets from ECC, SuperClaude, toolboxes, or local project conventions.

## Non-Invasive Extension Rules

Extensions must preserve project and harness ownership boundaries.

- Preserve existing `.claude/`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `Harness/README.md`, `Harness/workflows/*.md`, settings, and local rules unless the user explicitly requests an overwrite.
- Treat existing project config as project fact. Read it before adding assets, then adapt new assets to the project instead of replacing the project.
- Register added agents, skills, workflows, and rules in `Harness/MEMORY.md` and this docs router where applicable.
- Added assets may extend `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, or `Harness/workflows/`, but they must not replace core harness docs.
- Core harness docs are `Harness/README.md`, `Harness/PROGRESS.md`, `Harness/specs/runtime/subagents.md`, `Harness/specs/runtime/context-loading.md`, `Harness/specs/runtime/dispatch.md`, `Harness/specs/runtime/agent-workflow.md`, and this file.
- If an optional workflow needs a new command or tool, document the command and fallback in `Harness/workflows/<name>.md` instead of changing core harness behavior.

## Agent Contract

Every added agent must have frontmatter:

```yaml
---
name: stack-agent-name
description: Use when ...
tools: Read, Grep, Glob
model: sonnet
---
```

Agent body must state:

- load first
- inputs required
- allowed write set or read-only
- forbidden scope
- verification or evidence
- return format from [subagents.md](../runtime/subagents.md) and [dispatch.md](../runtime/dispatch.md)

## Skill Contract

Every added skill must state:

- when to use
- docs to load
- required inputs
- allowed writes
- output format
- whether to update `Harness/PROGRESS.md` and task files
- whether to use [subagents.md](../runtime/subagents.md) and [dispatch.md](../runtime/dispatch.md)

Skills should extend the harness. They should not replace `Harness/README.md`, `Harness/PROGRESS.md`, `subagents.md`, `context-loading.md`, `dispatch.md`, or `agent-workflow.md`.

## Rules

- Do not add broad agents that can write anywhere.
- Do not add agents whose role overlaps an existing common agent without naming the difference.
- Do not add tools that bypass project permissions or user approval.
- Do not run stack-specific writing agents in parallel unless write sets are disjoint.
- If an added asset conflicts with this harness, adapt the asset instead of changing the core contract.

## Runtime Extensions

Runtime extensions are optional, lazy-installed capabilities. They must not add
large browser engines, crawlers, ASR models, or platform SDKs to the default
Harness package.

The shared layout is:

```text
<globalDir>/Harness/extensions/<id>/<version>/   # downloaded payload
<projectRoot>/Harness/extensions/lock.json      # project metadata only
<projectRoot>/Harness/extensions/config.json     # optional project metadata
```

`node Harness/scripts/extensions.mjs ensure --id <id> --global-dir <globalDir>
--project <projectRoot> --json` verifies the registry manifest and SHA-256
hashes, stages files, and atomically installs them in the global runtime. A
failed or offline download must not write a project lock or leave a partial
payload. The global cache is shared by projects; removing one project must not
delete it.

`wf-search-deep` is a downloadable extension. It only declares optional
BrowserOS Neo, user-installed media tools, and a user-configured Whisper/VLM
backend read from `Harness/extensions/config.json`; it never stores cookies,
tokens, host-specific deployment details, or SSH keys. `wf-ui` is a
built-in global-runtime capability that is lazy-loaded from the Harness
runtime, not a downloaded extension.

## Registration

After adding assets:

- list agents in `Harness/MEMORY.md#Agents`
- list skills in `Harness/MEMORY.md#Skills`
- list workflows by path in `Harness/MEMORY.md` or `Harness/README.md`
- update `Harness/PROGRESS.md` and `Harness/tasks/<task-id>/PROGRESS.md` when the asset affects current work
- run `node Harness/scripts/validate-harness.mjs`
