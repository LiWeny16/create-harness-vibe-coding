---
name: wf-agents-docs
description: Source-backed CLI invocation guide for Claude Code, Codex, and OpenCode automation. Use when invoking peer CLIs, writing batch tests, collecting cache telemetry, debugging command-line flags, or documenting cross-runtime agent usage for Harness workflows.
---

# WF Agents Docs

Use this skill before shelling out to `claude`, `codex`, or `opencode` from Harness workflows, peer review, cache tests, or automation scripts.

## Source Order

1. Prefer local `--help` for installed behavior: `claude --help`, `codex exec --help`, `opencode run --help`.
2. Confirm current behavior from official docs when a flag affects cost, auth, JSON parsing, session resume, tools/MCP, or telemetry.
3. Record the command, version/help source, stdout/stderr shape, and any failed invocation pattern when adding automation.

## Claude Code CLI

- Interactive: `claude`.
- Non-interactive JSON: pipe ASCII or UTF-8-safe stdin into `claude -p --output-format json`.
- Stream JSON requires verbose mode: `claude -p --output-format stream-json --verbose`.
- Continue/resume: `claude -c -p "..."` or `claude -p --resume <session-id> "..."`; for PowerShell automation, prefer stdin and validate non-empty JSON before parsing.
- Use `--max-budget-usd <amount>` in scripted probes.
- Use `--strict-mcp-config` without `--mcp-config` to ignore configured MCP servers for a run. Use `--safe-mode` only to disable project customizations. Use `--bare` only for minimal CLI probes, not for Harness/cache attribution, because it skips `CLAUDE.md`, skills, plugins, MCP, hooks, and auto memory.
- Use `--tools "Read,Grep,Glob"` or explicit `--allowedTools`/`--disallowedTools` for read-only probes.
- Prompt-cache telemetry appears in JSON `usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens`, and in statusline `context_window.current_usage.*`.

## Codex CLI

- Interactive: `codex`.
- Non-interactive: `codex exec "task"`.
- Read stdin as the full prompt: `cat prompt.txt | codex exec -`.
- Prompt plus stdin context: `some-command | codex exec "summarize this output"`.
- Machine output: `codex exec --json "task"` emits JSONL events; parse `turn.completed.usage`, including `cached_input_tokens` when present.
- Resume: `codex exec resume --last "..."` or `codex exec resume <SESSION_ID> "..."`.
- Permissions: default is read-only; set `--sandbox workspace-write` only when edits are required. Use `--ignore-user-config` / `--ignore-rules` for controlled automation.

## OpenCode CLI

- Interactive: `opencode`.
- Non-interactive: `opencode run [message..]`.
- JSON events: `opencode run --format json "task"`.
- Resume: `opencode run --continue "..."` or `opencode run --session <id> "..."`.
- Peer role: `opencode run --agent reviewer --dir . "review prompt"`.
- Reuse a server to avoid MCP cold boot: `opencode serve`, then `opencode run --attach http://localhost:4096 "task"`.
- On Windows, first verify `opencode` exists before writing automation around it.

## PowerShell Automation Rules

- Prefer stdin over trailing prompt args for `claude -p` in PowerShell.
- Use ASCII prompts or explicitly UTF-8-safe input for automated probes.
- Do not trust exit code alone. Fail the wrapper when JSON stdout is empty, non-JSON, or has `subtype` / `terminal_reason` indicating error or budget exhaustion.
- Avoid naming function parameters `$Args`; PowerShell treats `$Args` specially.
- Store telemetry outside the repo, for example `$env:USERPROFILE\.claude\cache-telemetry\*.json`, so git status does not perturb prompt-cache prefixes.

## Cache Discipline

Follow `Harness/context-loading.md#Cache-First Context Contract`: keep stable instructions and CLI wrappers first, put timestamps/session IDs/raw command output in a dynamic suffix, and never claim provider cache behavior without usage telemetry. For Claude Code L2 use `cache_read_input_tokens`; for Codex JSONL use `cached_input_tokens` when emitted.

## Batch-Test Pattern

1. Probe command availability with `Get-Command claude,codex,opencode -ErrorAction SilentlyContinue`.
2. Run a cold turn and capture session id.
3. Resume that session for two warm turns.
4. For each turn record input, cache creation, cache read, ratio, cost, model/session id, and exact flags.
5. Compare against a control mode. Do not attribute a provider-wide cache feature to Harness unless the Harness-shaped run improves or stabilizes cache behavior against a comparable baseline.

## Official References

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code prompt caching: https://code.claude.com/docs/en/prompt-caching
- Claude Code status line schema: https://code.claude.com/docs/en/statusline
- Codex CLI: https://developers.openai.com/codex/cli
- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode
- OpenCode CLI: https://opencode.ai/docs/cli/
