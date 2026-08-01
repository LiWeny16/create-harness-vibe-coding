---
description: Open the Harness browser control panel for task capsules, workflow graphs, agent peers, settings, and terminal observability
---

# /wf-ui

Start the Harness browser control panel directly. This is a direct command.
Do not invoke a skill, do not start WF mode, and do not dispatch agents.

Run from the project root:

```bash
create-harness-vibe-coding wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

If you are inside the generator source repository and the global binary is not
available, use the local source entry:

```bash
node bin/create-harness-vibe-coding.js wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Otherwise use the package fallback:

```bash
npx create-harness-vibe-coding@0.8.20 wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Rules:
- Bind only to `127.0.0.1`.
- Use port `0` unless the user asks for a fixed port.
- Detach the server so the command returns after printing the URL.
- Return the local URL printed by the command.
