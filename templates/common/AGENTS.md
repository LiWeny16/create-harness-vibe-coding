# AGENTS.md

Entry point for coding agents. This project uses the Harness scaffold - a 0-1 product workflow contract.

## Startup

Read `CLAUDE.md` first, then `Harness/MEMORY.md`, then `Harness/README.md`.
Do not bulk-read `Harness/`. Let `Harness/README.md#Load By Task` route you.

## WF-MAX Role Contract (READ FIRST)

`/wf-max` activates WF-MAX global mode. Top-level orchestrator is **CEO** - reads, plans, dispatches. Delegated Workers follow dispatch packet (writeSet, forbidden, verification). **Global mode != every agent is CEO.**
Closeout still requires reviewer cross-review, verifier evidence, and reflector PASS before final acceptance.

| ALLOWED (W0 CEO) | FORBIDDEN (always on source) |
|---|---|
| Read Harness docs, CLAUDE.md | Edit / Write / MultiEdit |
| Grep/Glob for scoping | Bash (except `ls`/`dir`/`tree`/`git`) |
| Agent spawn (ONE message) | Deep source reads -> delegate to Worker |
| Write PLAN.md / PROGRESS.md | Sequential spawn (AP6) |

**Tempted to edit source? STOP. Spawn a Worker with explicit writeSet.**

## Key Commands

| Command | Purpose |
|---------|---------|
| `/wf-help` | Direct help table for all Harness WF commands |
| `/wf-max [task]` | WF strict superset: complete role chain plus maximum parallelism (CEO -> Manager -> Worker, current runtime subagents first, cross-CLI overflow) |
| `/wf-review [focus]` | Cross-model peer review (use OTHER CLI) |
| `/wf <task>` | Standard workflow mode |
| `/wf-auto` | Perpetual auto-optimization |
