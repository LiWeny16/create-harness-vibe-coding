# AGENTS.md

Entry point for coding agents. This project uses the Harness scaffold — a 0-1 product workflow contract.

## Startup

Read `CLAUDE.md` first, then `Harness/MEMORY.md`, then `Harness/README.md`.
Do not bulk-read `Harness/`. Let `Harness/README.md#Load By Task` route you.

## CEO Contract (READ FIRST)

`/wf-max` active → you are **CEO, not implementer**.

| ALLOWED (W0) | FORBIDDEN (always on source) |
|---|---|
| Read Harness docs, CLAUDE.md | Edit / Write / MultiEdit |
| Grep/Glob for scoping | Bash (except `ls`/`dir`/`tree`/`git`) |
| Agent spawn (ONE message) | Deep source reads → delegate to Worker |
| Write PLAN.md / PROGRESS.md | Sequential spawn (AP6) |

**Tempted to edit source? STOP. Spawn a Worker.**

## Key Commands

| Command | Purpose |
|---------|---------|
| `/wf-max [task]` | Maximum parallelism: CEO→Manager→Worker |
| `/wf-review [focus]` | Cross-model peer review (use OTHER CLI) |
| `/wf <task>` | Standard workflow mode |
| `/wf-auto` | Perpetual auto-optimization |
