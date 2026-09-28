# {{TASK_ID}} - REFERENCES

External evidence, logs, and links. Do not paste raw output; cite file paths, URLs, or commands that reproduce the result.

## Logs

| Description | File / Command | Date |
|-------------|---------------|------|
|             |               |      |

## Evidence

| What | Pointer | Verified |
|------|---------|----------|
|      |         | no       |

## Links

| Description | URL / Path |
|-------------|------------|
|             |            |

## Notes

Ad-hoc observations that don't fit PROGRESS, PLAN, or PROBLEM.
-

## Pi RPC Mode
- URL: https://pi.dev/docs/latest/rpc
- Source type: official
- Version: pi.dev/docs/latest; checked 2026-09-28
- License: MIT (Pi project; no source code copied)
- Decision: adapt
- Reason: Use the long-lived JSONL child-process protocol, correlated responses, session events, and settled lifecycle for the Pi driver. Verify strict LF framing and stdout/stderr separation in the implementation.
- AC IDs: AC-2, AC-3, AC-5, AC-6
- Checked at: 2026-09-28

## Run Pi safely
- URL: https://pi.dev/docs/latest/security
- Source type: official
- Version: pi.dev/docs/latest; checked 2026-09-28
- License: MIT (Pi project; no source code copied)
- Decision: adapt
- Reason: Pi does not ask approval before every tool call and recommends OS/container isolation for security boundaries. Do not present a UI mode toggle as a security boundary; resolve the host-side gating contract with the user.
- AC IDs: AC-4
- Checked at: 2026-09-28

## Pi Extensions
- URL: https://pi.dev/docs/latest/extensions
- Source type: official
- Version: pi.dev/docs/latest; checked 2026-09-28
- License: MIT (Pi project; no source code copied)
- Decision: adapt
- Reason: Pi extensions can block `tool_call`; in RPC mode, `ctx.ui.confirm` is forwarded as a correlated `extension_ui_request` and `extension_ui_response`. User selected a repo-owned, bundled host gate on 2026-09-28.
- AC IDs: AC-4
- Checked at: 2026-09-28

## Pi RPC Extension UI
- URL: https://pi.dev/docs/latest/rpc-extension-ui
- Source type: official
- Version: pi.dev/docs/latest; checked 2026-09-28
- License: MIT (Pi project; no source code copied)
- Decision: adapt
- Reason: `confirm` requests use `{ type: "extension_ui_request", id, method: "confirm", ... }`; the host resolves them with `{ type: "extension_ui_response", id, confirmed }` or cancellation. The id is the correlation key for the host approval card.
- AC IDs: AC-4
- Checked at: 2026-09-28

## Runtime Permission Modes
- Claude Code URL: https://docs.anthropic.com/en/docs/claude-code/sdk
- Codex app-server URL: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- OpenCode URL: https://dev.opencode.ai/docs/permissions/
- Source type: official runtime documentation/source
- Version: latest documentation/current main; checked 2026-09-28
- Decision: adapt
- Reason: Claude's documented modes are `default`, `acceptEdits`, `bypassPermissions`, and `plan`; Codex app-server exposes `approvalPolicy` values; OpenCode exposes permission actions `ask`, `allow`, and `deny`. Runtime drivers declare only modes their installed protocol can enforce and confirm changes before the UI updates.
- AC IDs: AC-4
- Checked at: 2026-09-28
