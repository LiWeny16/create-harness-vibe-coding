---
name: wf-ui
description: Codex compatibility: use $wf-ui or /skills wf-ui in Codex. In Claude Code and OpenCode, /wf-ui is a direct command that starts the local Harness browser control panel.
---

# WF-UI Adapter

This skill is a Codex compatibility shim for opening the Harness control panel.
Claude Code and OpenCode handle `/wf-ui` as a direct command. Do not route this
through WF mode.

## Invocation

- Codex CLI or IDE: use `$wf-ui` or `/skills` then choose `wf-ui`.
- Claude Code: `/wf-ui` is a direct command from `.claude/commands/wf-ui.md`.
- OpenCode: `/wf-ui` is a direct command from `.opencode/commands/wf-ui.md`.

## Load

No router preload. Read only the local command file above when this runtime
needs the exact direct command text.

## Cache Discipline

Keep the context to the command, current project root, and returned local URL.
Do not paste full API responses, accessibility trees, or terminal transcripts.

## Startup

Run from the project root:

```text
create-harness-vibe-coding wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

If you are inside the generator source repository and the global binary is not
available, use:

```text
node bin/create-harness-vibe-coding.js wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Otherwise use:

```text
npx create-harness-vibe-coding@0.8.20 wf-ui --project . --host 127.0.0.1 --port 0 --open --detach
```

Rules:
- Bind only to `127.0.0.1`; never `0.0.0.0`.
- Default port `0` for an OS-assigned free port.
- Generate a random one-time token.
- Open `http://127.0.0.1:<port>/?token=<token>`.
- Detach the server so command timeouts do not stop the control panel.

## Architecture

```text
Browser UI (React + TypeScript + Motion for React + Lucide)
    |
    | HTTP JSON APIs + WebSocket
    v
Local Node server bound to 127.0.0.1 only
    |
    | fs + task-state.mjs + optional node-pty
    v
Project-local Harness files (tasks/**, settings, version, command surfaces)
```

## Communication Protocol

- HTTP snapshots are canonical state: `/api/tasks`, `/api/settings`, `/api/project`.
- WebSocket events are invalidation hints only. The UI refreshes HTTP snapshots
  on reconnect or sequence gaps.
- Browser writes go through typed `POST` endpoints.
- `Harness/tasks/**` is the durable source of truth; UI state is derived.

## Security

- Loopback-only binding (`127.0.0.1`).
- One-time token auth on HTTP and WebSocket.
- Path traversal prevention on all task capsule reads.
- Command allowlist for PTY: `claude`, `codex`, `opencode`.
- Terminal default mode: watch/read-only; attach mode is explicit.
- `node-pty` is optional; missing means the terminal session reports blocked.
