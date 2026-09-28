# task-fix-ai-command-semantics - PLAN

## Goal

- Outcome: Correct the remote `ai` command grammar so model-family startup is explicit and `ai off` is an all-model shutdown.
- Non-goals: change model weights, expose an ASR port publicly, or alter the existing Qwen profile definitions.

## Scope

- Write set: Whisper integration artifacts, the wf-search video reference, regression tests, and the remote `/usr/local/bin/ai` command.
- Forbidden: credentials, cookies, unrelated worktree files, and silent changes to model selection semantics.

## Acceptance

| ID | Given / When / Then | Evidence | Status |
| --- | --- | --- | --- |
| AC-001 | Given the `ai` command, when `ai on`, `ai on minimax`, or `ai on whisper` is called, then the default/Qwen, video, or Whisper family is selected explicitly. | source regression test and remote command smoke | pending |
| AC-002 | Given any active family, when `ai off` is called, then Qwen, Whisper, and Minimax are stopped and GPU memory cleanup runs. | source regression test and remote `ai off`/`ai status` | pending |
| AC-003 | Given a model selection change, when `ai switch <profile>` is called, then the existing profile switcher remains the switching surface and does not redefine bare `ai on`. | switcher test and remote fast/whisper switch smoke | pending |

## Contract

| Surface | Contract |
| --- | --- |
| `ai on [qwen|minimax|whisper]` | Start one family; omitted argument means Qwen fast profile. |
| `ai off` | Stop llama-server, whisper-server, and Minimax/ComfyUI, then drop caches. |
| `ai switch <fast|max|vision|official|whisper>` | Switch profile through the existing profile switcher; Whisper remains mutually exclusive with llama-server. |

## Verification commands

- `node --test tests/wf-search-ai.test.js tests/wf-search-media.test.js tests/wf-search-install.test.js`
- `npm test`
- `node Harness/scripts/validate-harness.mjs --strict`
- `npm run build:version -- --check`
- Remote: `ai off`, `ai on`, `ai on whisper`, `ai switch fast`, `ai switch whisper`, `ai status`
