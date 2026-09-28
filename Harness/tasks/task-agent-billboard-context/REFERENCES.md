# task-agent-billboard-context - REFERENCES

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|
| TDD RED: Billboard metadata and Agent shared context were missing; picker selector was absent. | `workflow-agent-billboard.test.mjs`, `workflow-billboard.spec.ts` | 2026-09-28 |
| Backend green: Billboard storage/actions/context and existing A2A message contracts. | `node --test src/wf-ui-server/__tests__/workflow-agent-communication.test.mjs src/wf-ui-server/__tests__/workflow-agent-messages-structured.test.mjs src/wf-ui-server/__tests__/workflow-agent-billboard.test.mjs` (13 passed) | 2026-09-28 |
| UI green: resource picker, empty state, append via existing Markdown action, readable compact rows after reload, normal Markdown editor preserved; screenshot isolates the Billboard card. | `$env:WF_UI_E2E_PORT='43180'; pnpm --dir src/ui exec playwright test e2e/workflow-billboard.spec.ts --workers=1` (1 passed) | 2026-09-28 |
| Type validation and production bundle. | `pnpm --dir src/ui run typecheck`; `pnpm --dir src/ui run build` (passed; existing large-chunk warning) | 2026-09-28 |
| Coverage configuration audit: no coverage script or threshold is configured in root/UI package files and no ECC testing rule file was found in the checked skill/rule directories. | `package.json`, `src/ui/package.json`, `rg --files .agents .claude src/ui src/wf-ui-server | rg -i '(^|/)(common/)?testing\.md$|coverage'` | 2026-09-28 |

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
| AC-001 canonical Markdown storage, revisions, locks and actions | `src/wf-ui-server/__tests__/workflow-agent-billboard.test.mjs` | yes |
| AC-002 shared connected context, latest 20 entries, unconnected isolation | `src/wf-ui-server/__tests__/workflow-agent-billboard.test.mjs` | yes |
| AC-003 real API backed picker and compact canvas rendering | `src/ui/e2e/workflow-billboard.spec.ts`; `src/ui/test-results/workflow-billboard-AC-003--f2bf0-arkdown-editor-presentation/workflow-billboard-ac-003.png` | yes |
| AC-004 bridge envelopes and nodeId-only context refs | `src/wf-ui-server/__tests__/workflow-agent-communication.test.mjs`; `workflow-agent-messages-structured.test.mjs` | yes |

## Links

| Description | URL / Path |
|-------------|------------|

## Notes

-
