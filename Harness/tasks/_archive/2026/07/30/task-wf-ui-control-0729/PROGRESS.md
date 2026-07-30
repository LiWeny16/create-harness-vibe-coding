# task-wf-ui-control-0729 - PROGRESS

## Status

- Phase: Archived
- Next: follow-up polish only; core A2A filesystem/terminal/runtime/workflow control plane is implemented
- Blocker: none

## A2A Control Plane Expansion

- User clarification: A2A communication can use the filesystem, and skills/scripts should provide bounded READ/GLOB-style access to other terminals and agent session output.
- Controller decision: reopen the existing `$wf-ui` task because this extends the same control panel, not a separate product area.
- Default assumptions applied pending user correction: `Harness/a2a/` stores durable role/runtime/skill protocol facts; runtime state remains under task capsules; unmanaged OS terminals are out of MVP; `openclaw` and `pi` are detected but adapter-needed until their launch contracts are known.
- Product-manager role returned: `$wf-ui` should be a Harness Control Plane with runtime detection, multi-terminal sessions, CEO-to-subagent workflow observability, and Skills & Permissions as the explanation layer.
- Implemented: `Harness/a2a/` role/runtime/skill manifests, task-scoped session files, bounded terminal read/glob/input script, runtime detector, token-authenticated APIs, workflow hierarchy UI, runtime inventory UI, and attach-gated terminal input.
- PM acceptance: passed for the user's core requirement that A2A can use filesystem communication and bounded skills/scripts can read peer terminal/session output.

## A2A Verification

- [x] `pnpm --dir src/ui build` - passed
- [x] `node --test src/wf-ui-server/__tests__/*.test.mjs` - 112 passed
- [x] Same-process wf-ui smoke - root HTML, `/api/workflow`, `/api/runtimes`, `/api/a2a/skills` passed
- [x] `node Harness/scripts/a2a-terminal.mjs list-sessions --root .` - script reads Harness session state

## Completed

### Wave 0 — Exploration (all 4 agents)
- docs-researcher: Vite 8.1.5, Motion `motion/react`, React Flow v12 `@xyflow/react`, xterm security, node-pty, ws, Browser WS, Node HTTP
- codebase-explorer: 26-file checklist, classification: workflow command
- architect: Option A shipping model, MVP step 2.5, WS keepalive, standard error envelope
- test-writer: 28 valid + 14 supporting tests, 4-wave TDD order, UI_CONTRACT.md needed

### Wave 1 — CEO Synthesis
- All 8 ACs passed (planning phase)
- Architect overrides applied (Option A, step 2.5, keepalive, error envelope, peer API task-scoping)

### Groups 1-6 — Command Surface (26 files)
- [x] command-surface.json + template mirror
- [x] .claude/commands/wf-ui.md + template mirror
- [x] .opencode/commands/wf-ui.md + template mirror
- [x] .claude/skills/wf-ui/SKILL.md + template mirror
- [x] .agents/skills/wf-ui/SKILL.md + template mirror
- [x] wf-help.md updates (claude + opencode + templates)
- [x] Harness/README.md + template mirror
- [x] Harness/MEMORY.md + template mirror
- [x] Harness/scripts/wf-remove.mjs + template mirror
- [x] tests/pack-smoke.test.js — add 'wf-ui' to command array
- [x] tests/generator.test.js — add wf-ui to expected file lists
- [x] README.md — add wf-ui row to command table

### Groups 7-8 — Server Backend (src/wf-ui-server/)
- [x] src/wf-ui-server/token.mjs — generate/validate token (crypto.randomBytes, timingSafeEqual)
- [x] src/wf-ui-server/security.mjs — canonicalize path, safeResolve, validateTaskId
- [x] src/wf-ui-server/task-parser.mjs — parseTaskCapsule, parseTaskList
- [x] src/wf-ui-server/settings.mjs — loadSettings, resolveSettings (deep merge)
- [x] src/wf-ui-server/server.mjs — HTTP server: bind 127.0.0.1:0, token auth, /api/health, /api/project, /api/tasks, /api/tasks/:id, /api/settings, standard error envelope
- [x] 45 tests: 16 unit (token+security) + 14 parser/settings + 15 integration (server)

### Wave 3 — WebSocket + UI Shell
- [x] HTTP server + token auth + task APIs (53 tests pass)
- [x] WS /ws/events (8 tests pass)
- [x] React/Vite UI shell (Header, Footer, TaskList, placeholder routes)

## Tests

| Category | Count | Pass | Fail |
|----------|-------|------|------|
| Unit (token, security) | 16 | 16 | 0 |
| Unit (parser, settings) | 14 | 14 | 0 |
| Integration (server) | 15 | 15 | 0 |
| WS events | 8 | 8 | 0 |
| **Total** | **53** | **53** | **0** |

## Verification

- [x] node --test src/wf-ui-server/__tests__/*.test.mjs — 53 pass
- [x] tests/anti-drift.test.js — 6 pass
- [x] node Harness/scripts/validate-harness.mjs — passed
- [x] node templates/common/Harness/scripts/validate-harness.mjs — passed
- [ ] npm test (generator: 9 pass / 28 fail. git stash baseline confirms all failures predate wf-ui changes — same counts with stash applied.)
- [ ] npm run build:version -- --check
- [ ] Playwright E2E

## Fix Wave — Vite version honesty + AC dedup + build artifacts

- [x] src/ui/.gitignore created (node_modules, dist, *.tsbuildinfo)
- [x] src/ui/tsconfig.tsbuildinfo deleted
- [x] STATE.json: DUPLICATE AC-009/010/011 deduped (kept pending originals), AC-008 status corrected to pending w/ note "Playwright E2E not yet run"
- [x] STATE.json: decisions[] adds "Vite version: MVP uses Vite 6" and "xterm.js/React Flow: NOT yet in MVP deps"
- [x] STATE.json: phase changed from "done" to "fix-wave-active", nextAction rewritten with honest status
- [x] .claude/skills/wf-ui/SKILL.md: React Flow + xterm.js removed from arch diagram, note added re planned later phases
- [x] .agents/skills/wf-ui/SKILL.md: same

## Wave 4 Tasks

- [x] HTTP server + token auth + task APIs (53 tests pass)
- [x] WS /ws/events (8 tests pass)
- [x] React/Vite UI shell (Header, Footer, TaskList, placeholder routes)
- [ ] Session registry + PTY adapter + peer capsule (+12 new tests)
- [ ] Terminal WS (/ws/terminal/:sessionId) + multi-session isolation (+8 tests)
- [ ] UI Agents route: real runtime session list (not placeholder)
- [ ] UI Terminal drawer: xterm.js, session switching, watch/attach toggle
- [ ] Motion reduced-motion fallback hook
- [ ] Playwright E2E (Agents, terminal, reduced-motion)
- [ ] pnpm install + build + test for src/ui/
- [ ] npm run build:version + --check

### Confirmed
- Generator tests: 9 pass / 28 fail. git stash baseline confirms all failures predate wf-ui changes (same counts with stash applied).
- IPv4-only: documented decision, not a risk blocker.
- Motion `useReducedMotion` hook not confirmed — need custom prefers-reduced-motion fallback
