# Closeout: task-simplify-skills-hub-pack-prompt

Date: 2026-09-28  
Status: acceptance complete; closed through `task-state transition`.

## Result

Skills Hub now scans all five runtimes' user/project roots, groups matching names into collapsible families, and supports selecting or dragging skills into a prompt-bearing skill-pack node. The connected Agent context receives the pack prompt and skill names. The Hub is a selection surface; Market routes and UI have been removed from the active surface.

## Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-001 | Pass | `workflow-skills-hub.test.mjs` and `wf-ui-skills-hub-drag.spec.ts`: all five runtime roots and `scope=all`. |
| AC-002 | Pass | Hub grouping tests and E2E: family sections are collapsed by default and expand on demand. |
| AC-003 | Pass | `workflow-skills-hub-pack.test.mjs`: optional pack prompt persists, reads back, and derives a default when omitted. |
| AC-004 | Pass | `workflow-agent-context.test.mjs`: connected pack prompt and skill names appear in Agent context. |
| AC-005 | Pass | `wf-ui-skills-hub-drag.spec.ts`: selecting skills and the single primary action creates one pack node; drag remains supported. |
| AC-006 | Pass | `workflow-skills-market-unwired.test.mjs`, `wf-ui-skills-hub-drag.spec.ts`, and `wf-ui-m4-w38.spec.ts`: no Market surface or active route requests. |
| AC-007 | Pass | UI build passed; server suite 894/894; root suite 610 passed, 1 skipped; full UI E2E status passed (126 passed, 2 retried/flaky); root E2E 177/177; pack smoke 3/3. |

## Review and verification

- Focused Skills Hub server tests: 9/9 passed.
- Focused Skills Hub UI E2E: 15/15 passed.
- Full wf-ui-server suite: 894/894 passed.
- Full root suite: 610 passed, 1 skipped, 0 failed.
- Full UI E2E completed with passed status; two unrelated M3 cases passed on retry and in isolated reruns.
- Market-related routes/imports are unwired from the Hub surface; `workflow-skills-market.mjs` remains on disk as specified.

The capsule remains live and closed; archival is a separate operation.
