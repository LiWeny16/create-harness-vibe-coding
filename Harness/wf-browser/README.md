# wf-browser Runtime Artifacts

`Harness/wf-browser/` stores browser debug/control evidence created by
`wf-browser`, the Harness Bridge, and fallback browser drivers. Keep high-volume
runtime data here instead of in chat, task state, or long markdown logs.

## Layout

```text
Harness/wf-browser/
  README.md
  runs/
    <runId>/
      manifest.json
      timeline.jsonl
      sessions.json
      windows/
        <windowId>/
          browser-launches.json
          actions.jsonl
          screenshots/
          ui-tree/
          state/
          logs/
          network/
          ast/
          replay/
          analysis/
  tmp/
  cache/
```

## Rules

- Partition artifacts by `runId`, `sessionId`, `windowId`, and `agentId`.
- Store full screenshots, UI trees, app state, logs, network summaries, AST
  dumps, replay data, and videos as files. WebSocket messages should carry only
  bounded metadata, paths, hashes, sizes, and short summaries.
- A write/control lease is exclusive per window. Multiple subagents may run at
  the same time only when they own different windows or hold explicit read-only
  observation leases.
- `browser-allocate-many` creates one run with multiple window/lease/launch URL
  assignments for concurrent subagent dispatch.
- `browser-open --context isolated` opens a visible Chrome/Edge/Chromium window
  with a per-run/window profile under `tmp/browser-profiles/` and stores launch
  metadata under the window `analysis/` artifacts and `browser-launches.json`.
- `browser-launches` lists recorded launches with process liveness, and
  `browser-close --remove-profile true` closes selected launches and removes
  their isolated profiles.
- `browser-wait` waits for the requested run/window/agent frontend to register
  before a subagent dispatches `observe.*`, `act.*`, or snapshot commands.
- `browser-snapshot` captures the standard connected-window handoff bundle:
  route, capabilities, UI tree, state, logs, network, replay, and diff.
- `actions.jsonl` records every `act.*` command, target resolution, before/after
  observation ids, status, and artifact paths.
- `timeline.jsonl` records command lifecycle, route changes, console/runtime
  errors, network events, mixed-control collisions, and cleanup.
- Default local debugging is trusted and open. Do not redact artifacts unless
  project policy or user instruction asks for redaction.

## Cleanup

Default retention is latest 20 runs or 7 days. Do not delete runs referenced by
an active task. `tmp/browser-profiles/` is per-window launch scratch data; keep
it only while the run is useful. Use
`node Harness/scripts/wf-ui-control.mjs browser-close --remove-profile true` for
per-window closeout, then `node Harness/scripts/wf-ui-control.mjs
browser-cleanup` to preview run cleanup. Add `--apply true` only when the
eligible run list is correct.
