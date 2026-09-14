---
description: Initialize this project with the Harness runtime — global bridge by default (`--scope global`), or classic full project-level install (`--scope project`)
---

# /wf-init

Initialize the current project with the Harness runtime. This is a direct command.
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
npx create-harness-vibe-coding@latest init .
```

Install scopes:

- `--scope global` (default) — thin bridge: the project keeps only bridge docs (CLAUDE.md, AGENTS.md, Harness README/MEMORY/SETUP) plus its own state (`Harness/tasks/`, memory, `PROGRESS.md`, settings). Framework files, commands, skills, agents, and scripts load once from the machine-level global runtime, which is the single version source of truth.
- `--scope project` — classic full project-level install: the whole framework is copied into the project so it stays self-contained; update per project with `/wf-update`.

Useful flags:

- `--migrate` with `--scope global` migrates an existing project-level install: it removes safe Harness-owned framework files, keeps project/user state, and writes the global bridge.

- `--dry-run` — print the plan without writing.
- `--on-conflict <policy>` — `fail`, `skip` (default), `backup`, or `overwrite`. Keep `skip` so user-authored files are never clobbered.
- `--global-dir <dir>` / `--host-global-dir <dir>` — override the global runtime and host-copy locations (global scope only).

Rules:

- For a legacy project-level install, ask before using `--scope global --migrate`; migration preserves tasks, progress, memory, research, project facts, README/package files, and modified or user-authored Harness-interest files.

- Never overwrite user-authored files; the default conflict policy is `skip`.
- If Harness already exists in the project, report the update path and stop — do not re-init.
- Return the printed install scope, the global runtime path (global scope), and the next-step hints (`/wf-ui`, `/wf <task>`).
