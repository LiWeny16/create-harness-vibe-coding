---
name: wf-browser
description: AI-driven browser automation for E2E testing, web scraping, form filling, and UI verification. Powered by Browser Use (89.1% WebVoyager benchmark). Use for /wf-browser, browser testing, web automation, page interaction, form filling, screenshot verification, or any task requiring real browser control. Dual mode: CLI (fast iteration, no LLM needed) + Python Agent API (complex multi-step workflows with AI reasoning).
---

# WF Browser — AI Browser Automation

Load:

- `Harness/workflows/browser-e2e.md`
- Official `browser-use` skill at `~/.claude/skills/browser-use/SKILL.md` (auto-installed if missing)
- `Harness/PROGRESS.md` when work is active

## Modes

Choose based on task complexity:

### Mode 1: CLI (fast iteration, ~50ms per call)

Best for: single-page checks, quick screenshots, form fills, element inspection. No LLM needed — Claude Code reasons and issues CLI commands.

```bash
browser-use --headed open https://example.com   # Open page (headed = visible browser)
browser-use state                                # Get page title, text, interactive elements with indices
browser-use screenshot evidence.png              # Capture screenshot as evidence
browser-use click 5                              # Click element by index from state output
browser-use input 3 "user@example.com"           # Fill input field by index
browser-use eval "document.title"                # Run JavaScript in page
browser-use close                                # Close browser when done
```

Daemon keeps the browser open between commands — no cold-start per action.

### Mode 2: Python Agent API (multi-step AI reasoning)

Best for: complex multi-page workflows, dynamic navigation, data extraction across pages. Needs LLM API key.

```python
from browser_use.beta import Agent, BrowserProfile
from browser_use.llm import ChatAnthropic

agent = Agent(
    task="Go to github.com, search for 'browser-use', click the first result, and report the star count",
    llm=ChatAnthropic(model="claude-haiku-4-5-20251001"),
    browser_profile=BrowserProfile(headless=False),
)
history = await agent.run()
print(history.final_result())
```

## Environment Setup

Run once per machine:

```bash
# 1. Install browser-use with CLI extras
pip install "browser-use[cli]"

# 2. Install Chromium browser
browser-use install

# 3. Verify installation
browser-use doctor

# 4. (Optional) Set LLM API key for Agent mode
# Create .env file with: ANTHROPIC_API_KEY=sk-ant-...
# Or: OPENAI_API_KEY=sk-...
# Or: BROWSER_USE_API_KEY=bu-...
```

### Windows GBK Encoding Fix

If you see `UnicodeEncodeError: 'gbk' codec can't encode character`, the install is auto-patched. If not, set env var before commands:

```bash
set PYTHONIOENCODING=utf-8
```

### Requirements

| Requirement | Version | Check |
|-------------|---------|-------|
| Python | >= 3.11 | `python --version` |
| pip | any | `pip --version` |
| Chromium | auto-installed | `browser-use doctor` |
| LLM API key | for Agent mode only | check `.env` |

## Common Patterns

### Login Persistence

```bash
# Use real Chrome profile (preserves cookies/logins)
browser-use --profile "Default" open https://app.target.com
# Or connect to running Chrome with remote debugging
browser-use connect
```

### E2E Test Flow

```bash
browser-use --headed open https://yourapp.local
browser-use state                          # Verify page loaded
browser-use screenshot step1-landing.png   # Evidence
browser-use input 3 "test@email.com"       # Fill email
browser-use input 5 "password123"          # Fill password
browser-use click 8                        # Click login button
browser-use wait text "Dashboard"           # Wait for navigation text
browser-use state                          # Verify logged in
browser-use screenshot step2-dashboard.png # Evidence
browser-use close
```

### Console & Network Log Capture

```bash
browser-use eval "console.log('checkpoint');"   # Inject log marker
browser-use eval "document.title"                # Read page state via JS
browser-use get text 5                           # Get text of element index 5
browser-use get value 3                          # Get value of input element index 3
# For full console/network: use Python Agent mode with Playwright's page.on('console') and page.on('request')
```

### Error Recovery

```bash
# If daemon crashes or gets stuck:
browser-use close          # Clean shutdown
# Then restart:
browser-use open <url>     # Fresh daemon starts automatically
```

## Verification Contract

Every browser task must produce:

1. **State evidence**: `browser-use state` output or screenshot
2. **Action log**: sequence of commands issued
3. **Result assertion**: explicit before/after state comparison

No browser/UI claim without real-browser evidence.

## Architecture Note

Browser Use wraps Playwright with AI reasoning. The daemon keeps Chromium running between CLI commands (~50ms latency). The Agent mode adds an LLM observation→decision→action loop on top. This replaces fragile CSS-selector scripts with semantic element targeting via accessibility tree snapshots.

Benchmarks: 89.1% WebVoyager (SOTA), 78k+ GitHub stars, MIT license.

## Security

- **Never log or screenshot credentials** — redact password fields, API keys, tokens before capturing evidence
- **Chrome profiles contain sensitive data** — only use `--profile` with explicit user approval; never share profile data
- **Screenshots may capture PII** — review before saving to task evidence directory
- **Scraping targets need approval** — confirm the target site's ToS allow automated access before scraping
- **`browser-use input` commands with passwords** — use placeholder values in documentation; never hardcode real credentials
- **Agent mode sandbox** — run Agent API with `allowed_domains` restriction when possible

## Return

- CLI commands issued and their output
- screenshot paths
- agent history (if Agent mode used)
- verification pass/fail with evidence
- remaining risks (flaky selectors, auth issues, CAPTCHAs)
