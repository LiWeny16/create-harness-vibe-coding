# task-terminal-input-control - PLAN

## Goal

- Outcome: Make WF UI terminal interaction controlled enough that Codex terminal noise, copy/paste failures, file drag/drop gaps, and multi-viewer input loops are fixed without replacing the terminal emulator.
- Non-goals: Do not hand-write a full ANSI terminal emulator. Do not change runtime launch semantics. Do not publish or version the package.

## Mini PRD

- Users need the WF UI terminal to behave like a real work surface: copy selected output, paste from clipboard, drop files, and send intentional input only.
- Codex/xterm control responses such as OSC 10/11 color reports must not appear in the Codex prompt input.
- Canvas embedded terminals should prioritize fast, read-only output viewing; the drawer terminal is the controlled attach/input surface.

## Scope

- Write set:
  - `src/ui/src/terminalControl.ts`
  - `src/ui/src/components/TerminalDrawer.tsx`
  - `src/ui/src/components/WorkflowRoute.tsx`
  - `src/ui/src/index.css`
  - `src/ui/src/i18n/translations.ts`
  - `src/wf-ui-server/server.mjs`
  - `src/wf-ui-server/terminal-store.mjs`
  - `src/wf-ui-server/__tests__/server.integration.test.mjs`
  - `tests/anti-drift.test.js`
- Forbidden:
  - Replacing `@xterm/xterm`
  - Replacing `node-pty`
  - Version/publish changes
  - Destructive git operations

## Acceptance

| ID | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| AC-001 | OSC color query reports and visible leaked `]10;rgb...` fragments are swallowed before reaching PTY input; normal user text still passes through. | unit/static tests + frontend typecheck | pending |
| AC-002 | Ctrl+Shift+C copies terminal selection, terminal UI exposes copy/paste controls, and embedded terminals are read-only viewers by default. | anti-drift + browser check | pending |
| AC-003 | Dropped files are written below the session directory and returned as quoted terminal paths without path traversal. | backend integration test + browser check | pending |

## Expanded Contracts

### UI Contract

| Element | Selector | AC IDs |
|---|---|---|
| Drawer terminal output/drop target | `data-testid="terminal-output"` | AC-001, AC-002, AC-003 |
| Drawer copy action | `data-testid="terminal-copy-selection"` | AC-002 |
| Drawer paste action | `data-testid="terminal-paste-clipboard"` | AC-002 |
| Embedded terminal attach/viewer | `data-testid="workflow-terminal-attach"` | AC-001, AC-002, AC-003 |

### API Contract

`POST /api/sessions/:sessionId/drop-files`

Request:
```json
{
  "files": [
    {
      "name": "example.txt",
      "contentBase64": "SGVsbG8="
    }
  ]
}
```

Success:
```json
{
  "files": [
    {
      "name": "example.txt",
      "path": "D:\\Project\\Harness\\a2a\\sessions\\session-1\\drops\\example.txt",
      "size": 5,
      "terminalText": "'D:\\Project\\Harness\\a2a\\sessions\\session-1\\drops\\example.txt'"
    }
  ],
  "terminalInput": "'D:\\Project\\Harness\\a2a\\sessions\\session-1\\drops\\example.txt'"
}
```

## Risks

| Risk | Mitigation | Status |
|------|------------|--------|
| Browser cannot reveal local source path for drag/drop. | Upload file contents into a session drop directory and insert that path. | accepted |
| Swallowing all terminal response data could break TUIs. | Only intercept known OSC color query reports and keep typed input path intact. | pending |
| Multiple terminal viewers can reintroduce input loops. | Embedded terminal becomes a read-only viewer; drawer owns attach/input. | pending |
