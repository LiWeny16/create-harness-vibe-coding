# task-web-terminal-smoothing - REFERENCES

## Logs

| Focused terminal lifecycle acceptance | `$env:WF_UI_E2E_PORT='43174'; pnpm --dir src/ui exec playwright test e2e/wf-ui-m4-interactions.spec.ts --grep 'task-web-terminal-smoothing'` — 1 passed | 2026-09-28 |
| UI typecheck | `pnpm --dir src/ui run typecheck` — passed | 2026-09-28 |
| UI production build | `pnpm --dir src/ui run build` — passed; existing large-chunk warnings | 2026-09-28 |
| Full M4 interaction file | 6 passed; two unrelated long-task threshold failures at 259 ms and 263 ms | 2026-09-28 |

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| Playwright session preservation, resize, fullscreen, minimize/restore, session isolation, and deletion | `src/ui/e2e/wf-ui-m4-interactions.spec.ts` AC-001/002/003 | yes |
| Backend runtime snapshot | `GET http://127.0.0.1:43175/api/workflow` — graph version 2397, 4 nodes; no temporary QA Agent nodes | yes |
| Backend session cleanup | `GET http://127.0.0.1:43175/api/sessions?all=1` — 3 historical QA sessions, all stopped, `wsClientCount: 0` | yes |
| Earlier failure reproduction | `src/ui/test-results/wf-ui-m4-interactions-WF-U-5afa1-yncs-resized-PTY-dimensions/test-failed-1.png` | yes |

## Links

| Description | URL / Path |
|-------------|------------|
| Implementation | `src/ui/src/components/TerminalDrawer.tsx` |
| Task plan | `Harness/tasks/task-web-terminal-smoothing/PLAN.md` |

## Notes

- BrowserOS Neo artifacts from before the user's redirect are retained as historical files and are not used as current acceptance evidence.
