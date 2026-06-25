# Browser E2E Workflow

Optional workflow for browser-visible testing and automation. Installed when `browser-use` CLI is available.

## When Active

This workflow is active when:
1. `browser-use` CLI is installed and `browser-use doctor` passes
2. `Harness/workflows/browser-e2e.md` exists (this file)
3. A task explicitly references `/wf-browser` or browser E2E testing

## Contract

Browser evidence in this project follows the contract:

1. **Every browser claim needs real-browser evidence** — screenshot, state snapshot, or console output
2. **CLI mode is preferred for deterministic steps** — use `browser-use open/state/click/screenshot` for predictable flows
3. **Agent mode is for dynamic exploration** — use Browser Use Agent API when the page structure is unknown or changing
4. **Evidence goes to the task directory** — `Harness/tasks/<task-id>/evidence/*.png`

## Quick Install

```bash
# One-time setup
pip install "browser-use[cli]"
browser-use install
browser-use doctor

# Windows: if you see GBK encoding errors, set:
set PYTHONIOENCODING=utf-8

# Verify
browser-use open https://example.com
browser-use state
browser-use screenshot test.png
browser-use close
```

## Fallback

If `browser-use` is not installed, fall back to:

1. Playwright/Puppeteer MCP server (if configured)
2. Chrome DevTools Protocol (CDP) manual inspection
3. `Harness/WF.md#Browser And API Evidence` manual check contract

## Integration Points

- **WF mode**: when browser-visible changes are made, follow the evidence contract in `Harness/WF.md#Browser And API Evidence`
- **wf-browser**: the `/wf-browser` slash command loads this workflow + the skill via `.claude/commands/wf-browser.md`
- **MEMORY.md**: registered as optional workflow skill
- **README.md**: routing table row "Browser E2E testing or automation" → browser-e2e

## File Locations

| File | Purpose |
|------|---------|
| `.claude/skills/wf-browser/SKILL.md` | Skill definition |
| `.claude/commands/wf-browser.md` | Slash command bridge |
| `Harness/workflows/browser-e2e.md` | This file — workflow contract and install guide |
| `~/.claude/skills/browser-use/SKILL.md` | Official Browser Use skill (user-level, auto-downloaded) |
| `pip show browser-use \| findstr Location` | Python package install location (run to find) |
| `~/.browser-use/` | Daemon state and browser profiles |
