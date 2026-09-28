# Verification: ai command semantics

Date: 2026-09-17

## Acceptance results

- AC-001: PASS. `ai on` starts the Qwen 3.8 27B `fast` profile; `ai on minimax` starts H3/ComfyUI; `ai on whisper` starts the Whisper service.
- AC-002: PASS. `ai off` stops Qwen, Whisper, and Minimax and drops caches. Remote smoke reduced GPU usage to 29 MiB.
- AC-003: PASS. `ai switch whisper` and `ai switch fast` remain the switching surface and wait for their health endpoints before reporting success.

## Remote smoke evidence

Host: `onion@ecs.zingspark.tech:2222`

- `ai on`: ready in about 20 seconds; `ai status` reported Qwen active, health `{"status":"ok"}`, Whisper and Minimax inactive.
- `ai on whisper`: ready in about 5 seconds; `ai status` reported `profile=whisper`, Whisper `large-v3` on CUDA, Qwen and Minimax inactive.
- `ai on minimax`: H3 became healthy on `:8189`; Qwen and Whisper were inactive.
- `ai off`: Qwen, Whisper, and Minimax inactive; GPU reported 29 MiB.
- `ai switch whisper`: returned healthy and kept Whisper on localhost `127.0.0.1:8090`.
- `ai switch fast`: returned only after Qwen health `{"status":"ok"}`.

## Repository verification

- `node --test tests/wf-search-ai.test.js tests/wf-search-media.test.js tests/wf-search-install.test.js`: PASS (37 tests, 0 failures).
- `npm test`: PASS; one existing platform-dependent symlink test remained skipped.
- `node Harness/scripts/validate-harness.mjs --strict`: repository task-index/cap warnings remain because unrelated open task capsules predate this task; the implementation files validate through the targeted suite.
- `npm run build:version -- --check`: PASS (230 checksums, 249 sources).
- `npm run check:mirrors`: existing legacy mirror failures remain (`zingspark main` generator 0.9.4 and `zingspark v0.9.5` HTTP 404); canonical mirrors pass.
