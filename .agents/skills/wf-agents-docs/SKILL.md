---
name: wf-agents-docs
description: Source-backed CLI invocation guide for Claude Code, Codex, and OpenCode automation. Use when invoking peer CLIs, writing batch tests, collecting cache telemetry, debugging command-line flags, or documenting cross-runtime agent usage for Harness workflows.
---

# WF Agents Docs

Use this skill before shelling out to `claude`, `codex`, or `opencode` from Harness workflows, peer review, cache tests, or automation scripts.

## Source Order

1. Prefer installed help: `claude --help`, `codex exec --help`, `opencode run --help`.
2. Check official docs for flags that affect cost, auth, JSON, resume, tools/MCP, or telemetry.
3. When adding automation, record command, source, stdout/stderr shape, and failed patterns.

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
- Do not trust exit code alone. Fail on empty/non-JSON stdout or error/budget terminal fields.
- Avoid naming function parameters `$Args`; PowerShell treats `$Args` specially.
- Store telemetry outside the repo, e.g. `$HOME/.claude/cache-telemetry/*.json`, so git status does not perturb prefixes.

## Evidence-Packet Review Pattern

For peer review, route smokes, cache analysis, and audits, gather evidence
first; the peer judges only the bounded packet.

- Gather paths, line snippets, command names, exits, and invariants with `rg`,
  `node` scripts, validators, or small reads.
- Send only that packet. Exclude full docs, raw logs, timestamps, session IDs,
  and screenshots unless they are the evidence.
- Prefer no tools for judgment-only review; otherwise allow only read-only
  tools and name the exact read set.
- Controller accepts, rejects, or escalates findings. Peers do not own scope.

## No Scratch-File Rule

- Do not write CLI probe output under `%TEMP%`, `$env:TEMP`, `/tmp`, or other
  system temp directories.
- Prefer stdout, JSON/JSONL streaming, or in-memory parsing.
- Persistent repo evidence goes under `Harness/tasks/<task-id>/evidence/`.
- Cache telemetry may live under `$HOME/.claude/cache-telemetry/` to avoid repo
  prompt-cache churn.
- Do not create prompt temp files. Use stdin.

## Subagent Output Contract

Require bounded structured returns:

```text
Agent: <claude|codex|opencode|role name>
Probe: <what was tested or reviewed>
Mode: <read-only|review|telemetry|implementation>
Files examined: <exact paths or none>
Evidence: <commands, exit codes, paths, line refs>
Passes: <confirmed invariants>
Findings: <severity, file/path, reason, suggested fix>
Risks: <residual uncertainty or none>
Tool/CLI issues: <auth, timeout, budget, JSON parse, MCP, or none>
Verdict: PASS | FAIL | BLOCKED
Next: <smallest next controller action>
```

For JSON, use the same keys. Do not return transcripts, full file bodies, decorative logs, or speculation.

## Cache Discipline

Follow `Harness/specs/runtime/context-loading.md#Cache-First Context Contract`: stable instructions first, volatile output in the dynamic suffix, and no provider cache claims without telemetry. Claude Code L2 uses `cache_read_input_tokens`; Codex JSONL may emit `cached_input_tokens`.

## Batch-Test Pattern

1. Probe command availability with `Get-Command claude,codex,opencode -ErrorAction SilentlyContinue`.
2. Build a compact evidence packet before invoking peer agents; use the peer
   only for judgment unless the test explicitly requires live agent discovery.
3. Run a cold turn and capture session id.
4. Resume that session for two warm turns.
5. For each turn record input, cache creation, cache read, ratio, cost, model/session id, and exact flags.
6. Compare against a control mode. Do not attribute a provider-wide cache feature to Harness unless the Harness-shaped run improves or stabilizes cache behavior against a comparable baseline.

## Official References

- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Code prompt caching: https://code.claude.com/docs/en/prompt-caching
- Claude Code status line schema: https://code.claude.com/docs/en/statusline
- Codex CLI: https://developers.openai.com/codex/cli
- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode
- OpenCode CLI: https://opencode.ai/docs/cli/
