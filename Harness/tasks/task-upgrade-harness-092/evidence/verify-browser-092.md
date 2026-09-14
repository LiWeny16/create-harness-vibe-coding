# Pre-release UI/browser verification (bounded run)

Date: 2026-09-09 12:09–12:17 Asia/Shanghai  
Owned fixture: `Harness/.temp/browser-verify-092-jPQnpO`  
Owned wf-browser run: `run-mttl179i-f9f2a3`  
Window: `window-mttl179u-78d12d`  
Lease: `lease-mttl17a7-4f0674` (control, agent `agent-browser-verify-092`)

## Flow

- Built the existing UI with `npm run build --prefix src/ui` (Vite 6.4.3, 5538 modules, success). Only generated `src/ui/dist` was produced.
- Created the canonical task `task-browser-verify-092` in the isolated `makeHarnessTempRoot` fixture. It is a legal direct-mode task with status `active`, next action `Verify browser task and backend status`.
- Ran `node Harness/scripts/wf-ui-control.mjs ensure-backend --project <fixture> --port 0 --no-open --json`. It cold-started the project-scoped backend at `http://127.0.0.1:53306/`, PID 7116, with `openBrowser: false`; `/api/health`, `/api/project`, and `/api/tasks` all returned successfully.
- Allocated the run/window/lease with `browser-allocate --open false`, then opened its exact launch URL in the real Edge tab created by this verification. The first automatic open attempt was bounded and failed to connect; no user tabs were claimed or navigated. After the explicit launch URL was opened, the first-party bridge registered one frontend connection with 14 capabilities.
- The real page rendered the Tasks view and showed `task-browser-verify-092` with `active` status. Selecting that row opened the real inspector, which showed `task-browser-verify-092`, `STATUS active`, `PHASE intake`, `MODE direct`, and the task goal. The UI has one row; the backend's direct task intentionally has no global `activeTaskId`.

## Evidence artifacts

All paths below are under the owned run at `Harness/wf-browser/runs/run-mttl179i-f9f2a3/windows/window-mttl179u-78d12d/`.

- Route/state: `state/command-mttl59th-110a56.json`, `state/command-mttl59tv-d37014.json` (route id `tasks`, pathname `/`, page `tasks` mounted, bridge connection `connected`, inspector open with the task title).
- UI tree: `ui-tree/command-mttl59to-a73b93.json` (task id, status text, inspector capability and one visible row).
- Same-origin network: `network/command-mttl59u7-8ba83e.json` records `GET http://127.0.0.1:53306/api/tasks` and `GET .../api/tasks/archived`, both HTTP 200, plus same-origin project/settings/debug requests.
- Logs/replay: `logs/command-mttl59u1-54c27e.json`, `replay/command-mttl59ud-63cecf.json`.
- Lease before page close: `state/lease-observation.json` records the active control lease and exact run/window/agent binding.
- Real PNG viewport: `screenshots/cua-ui-viewport.png` (73,660 bytes, PNG signature `89 50 4E 47 0D 0A 1A 0A`, SHA-256 `71723E321ADA08F67F5A4482BF0C991DC23671C0B7A3A6084863D0AAF45F8AFD`).
- Real PNG task inspector: `screenshots/cua-task-inspector.png` (178,646 bytes, PNG signature verified, SHA-256 `FC98656E27FCD32FA321E07F532384948DE323CC4DA7FD6774BB39877E39A2F8`). These came from a real CUA screenshot; the JPEG CUA source files are retained beside them. The bridge's `observe.screenshot` correctly reported `SCREENSHOT_UNSUPPORTED` because no trusted fallback driver was available, so no fake bridge screenshot was recorded.

## Close/readability check

The owned Edge tab was closed; existing user tabs remained untouched. Immediately afterward, the backend still returned health `ok` (version `0.9.1`), project root equal to the isolated fixture, one task, and the same task id/status. The frontend connection list was empty as expected after page close. This exact response is in `state/backend-after-page-close.json` (1,504 bytes, SHA-256 `A2E6B485CF0DB1A2512C010A3157F74104801C3C1A0BB3F38DAB4E182FB7E72D`). The owned lease and the earlier failed allocation were then released; no browser launch record or unrelated process was closed.

No source, template, canonical task, version, Git, publish state, real A2A storage, or user task was modified.
