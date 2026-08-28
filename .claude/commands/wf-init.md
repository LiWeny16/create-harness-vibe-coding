---
description: Initialize this project against the globally installed Harness runtime (thin bridge docs + project-local state; global runtime is the single version source of truth)
---

# /wf-init

Initialize the current project against the global Harness runtime. This is a direct command.
Do not invoke a skill, do not start WF mode, and do not dispatch agents.

Run from the project root:

```bash
create-harness-vibe-coding init .
```

If you are inside the generator source repository and the global binary is not
available, use the local source entry:

```bash
node bin/create-harness-vibe-coding.js init .
```

Otherwise use the package fallback:

```bash
npx create-harness-vibe-coding@0.8.20 init .
```

Useful flags:

- `--dry-run` — print the plan without writing.
- `--on-conflict <policy>` — `fail`, `skip` (default), `backup`, or `overwrite`. Keep `skip` so user-authored files are never clobbered.
- `--global-dir <dir>` / `--host-global-dir <dir>` — override the global runtime and host-copy locations.

Rules:

- The project keeps only bridge docs (CLAUDE.md, AGENTS.md, Harness README/MEMORY/SETUP) and its own state (`Harness/tasks/`, `Harness/memory/`, `Harness/PROGRESS.md`, `Harness/settings.json`).
- Framework files, commands, skills, agents, and scripts are NOT copied into the project; they load from the single global runtime, which is the only version source of truth.
- Never overwrite user-authored files; the default conflict policy is `skip`.
- If Harness already exists in the project, report the update path and stop — do not re-init.
- Return the printed global runtime path and the next-step hints (`/wf-ui`, `/wf <task>`).
