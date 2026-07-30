---
description: Open the Harness browser control panel for task capsules, workflow graphs, agent peers, settings, and terminal observability
---

# /wf-ui

Start the Harness browser control panel directly. This is a direct command.
Do not invoke a skill, do not start WF mode, and do not dispatch agents.

Run from the project root:

```bash
create-harness-vibe-coding wf-ui --project . --host 127.0.0.1 --port 0 --open
```

If the global binary is not available, use the package fallback:

```bash
npx create-harness-vibe-coding@0.8.19 wf-ui --project . --host 127.0.0.1 --port 0 --open
```

Rules:
- Bind only to `127.0.0.1`.
- Use port `0` unless the user asks for a fixed port.
- Leave the server running until the user stops it.
- Return the local URL printed by the command.
